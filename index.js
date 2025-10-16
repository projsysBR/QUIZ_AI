import express from "express";
import fetch from "node-fetch";
import ytdl from "@distube/ytdl-core";
import FormData from "form-data";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const MAX = 25 * 1024 * 1024; // 25MB

const UA = { "User-Agent": "Mozilla/5.0" };

function isYouTube(url) { return /youtube\.com|youtu\.be/.test(url); }

// --- Sniffer de formato pelos primeiros bytes ---
function sniffContentType(buf) {
  if (!buf || buf.length < 12) return null;
  // MP3: "ID3" header
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return { ct: "audio/mpeg", ext: "mp3" };
  // MP3 frame sync 0xFF 0b111xxxxx
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return { ct: "audio/mpeg", ext: "mp3" };
  // WEBM/Matroska: 1A 45 DF A3
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return { ct: "audio/webm", ext: "webm" };
  // WAV: "RIFF....WAVE"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45)
    return { ct: "audio/wav", ext: "wav" };
  // MP4/M4A: "....ftyp"
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return { ct: "audio/mp4", ext: "m4a" };
  return null;
}

function extFromUrl(u) {
  try {
    const pathname = new URL(u).pathname || "";
    const m = pathname.match(/\.(mp3|m4a|mp4|webm|wav)(\?.*)?$/i);
    if (!m) return null;
    const ext = m[1].toLowerCase();
    if (ext === "mp3") return { ct: "audio/mpeg", ext: "mp3" };
    if (ext === "m4a" || ext === "mp4") return { ct: "audio/mp4", ext: "m4a" };
    if (ext === "webm") return { ct: "audio/webm", ext: "webm" };
    if (ext === "wav") return { ct: "audio/wav", ext: "wav" };
  } catch {}
  return null;
}

async function bufferFromYouTube(url, { maxBytes = MAX } = {}) {
  const info = await ytdl.getInfo(url, { requestOptions: { headers: UA } });
  const formats = ytdl.filterFormats(info.formats, "audioonly")
    .sort((a,b) => (b.audioBitrate||0) - (a.audioBitrate||0));
  const fmt = formats[0];
  const declaredCT = (fmt.mimeType || "").split(";")[0] || "";

  const audio = ytdl.downloadFromInfo(info, {
    format: fmt,
    highWaterMark: 1 << 25,
    requestOptions: { headers: UA }
  });

  const chunks = []; let size = 0;
  await new Promise((resolve, reject) => {
    audio.on("data", d => {
      size += d.length;
      if (size > maxBytes) { audio.destroy(); return reject(new Error("AUDIO_TOO_LARGE")); }
      chunks.push(d);
    });
    audio.on("end", resolve);
    audio.on("error", reject);
  });

  const buf = Buffer.concat(chunks);
  const sniff = sniffContentType(buf);
  const chosen = sniff || (declaredCT.startsWith("audio/") ? { ct: declaredCT, ext: declaredCT.includes("webm") ? "webm" : (declaredCT.includes("mp4") ? "m4a" : "mp3") } : null);
  const finalCT = chosen ? chosen.ct : "audio/mpeg";
  const finalExt = chosen ? chosen.ext : "mp3";
  return { buf, contentType: finalCT, ext: finalExt };
}

async function bufferFromDirect(url, { maxBytes = MAX } = {}) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`DIRECT_FETCH_${r.status}`);
  const serverCT = (r.headers.get("content-type") || "");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("AUDIO_TOO_LARGE");

  const sniff = sniffContentType(buf) || extFromUrl(url);
  let finalCT = serverCT.startsWith("audio/") ? serverCT : (sniff ? sniff.ct : "audio/mpeg");
  let finalExt = sniff ? sniff.ext : (serverCT.includes("webm") ? "webm" : (serverCT.includes("mp4") ? "m4a" : "mp3"));
  return { buf, contentType: finalCT, ext: finalExt };
}

app.post("/quiz-from-url", async (req, res) => {
  try {
    const { url, num = 5 } = req.body || {};
    if (!url) return res.status(400).json({ error: "Informe 'url'" });

    const out = isYouTube(url) ? await bufferFromYouTube(url) : await bufferFromDirect(url);
    const { buf, contentType, ext } = out;

    const form = new FormData();
    form.append("model", "gpt-4o-transcribe");
    form.append("file", buf, { filename: `media.${ext}`, contentType });

    const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });

    const trText = await tr.text();
    if (!tr.ok) {
      return res.status(500).json({
        error: "Transcription failed",
        details: { contentType, ext, size: buf.length, head: buf.slice(0, 12).toString("hex") },
        trText
      });
    }

    const data = JSON.parse(trText);
    const transcript = data.text;

    const qBody = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é um gerador de questionários." },
        { role: "user", content: `Gere ${num} perguntas de múltipla escolha (5 alternativas, 1 correta) com base neste texto: ${transcript}.` }
      ]
    };

    const qResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(qBody)
    });

    const qData = await qResp.json();
    return res.json(qData);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
