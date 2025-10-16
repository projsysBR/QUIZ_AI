import express from "express";
import fetch from "node-fetch";
import ytdl from "@distube/ytdl-core";
import FormData from "form-data";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const MAX = 25 * 1024 * 1024; // 25MB limite

const UA = { "User-Agent": "Mozilla/5.0" };

const DEFAULT_CT = "audio/webm";
function extFromContentType(ct = "") {
  if (ct.includes("audio/mpeg")) return "mp3";
  if (ct.includes("audio/mp4") || ct.includes("video/mp4")) return "m4a";
  if (ct.includes("audio/webm") || ct.includes("video/webm")) return "webm";
  if (ct.includes("audio/wav")) return "wav";
  return "bin";
}

async function bufferFromYouTubeWithRetry(url, { maxBytes = MAX, retries = 3 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      const info = await ytdl.getInfo(url, { requestOptions: { headers: UA } });
      const formats = ytdl.filterFormats(info.formats, "audioonly")
        .sort((a,b) => (b.audioBitrate||0) - (a.audioBitrate||0));
      const fmt = formats[0];
      const ct = (fmt.mimeType || "").split(";")[0] || DEFAULT_CT;

      const audio = ytdl.downloadFromInfo(info, {
        format: fmt,
        highWaterMark: 1 << 25,
        requestOptions: { headers: UA }
      });

      const chunks = [];
      let size = 0;
      await new Promise((resolve, reject) => {
        audio.on("data", (d) => {
          size += d.length;
          if (size > maxBytes) { audio.destroy(); return reject(new Error("AUDIO_TOO_LARGE")); }
          chunks.push(d);
        });
        audio.on("end", resolve);
        audio.on("error", reject);
      });
      const buf = Buffer.concat(chunks);
      return { buf, contentType: ct };
    } catch (e) {
      if (attempt++ >= retries) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

async function bufferFromDirect(url, { maxBytes = MAX } = {}) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`DIRECT_FETCH_${r.status}`);
  const ct = (r.headers.get("content-type") || "");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("AUDIO_TOO_LARGE");
  return { buf, contentType: ct };
}

function isYouTube(url) { return /youtube\.com|youtu\.be/.test(url); }
function isVimeo(url) { return /vimeo\.com/.test(url); }

app.post("/quiz-from-url", async (req, res) => {
  try {
    const { url, num = 5 } = req.body || {};
    if (!url) return res.status(400).json({ error: "Informe 'url'" });

    let out;
    if (isYouTube(url)) out = await bufferFromYouTubeWithRetry(url);
    else out = await bufferFromDirect(url);

    const { buf, contentType } = out;
    const ext = extFromContentType(contentType);

    const form = new FormData();
    form.append("model", "gpt-4o-transcribe");
    form.append("file", buf, { filename: `media.${ext}`, contentType });

    const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });

    const trText = await tr.text();
    if (!tr.ok) return res.status(500).json({ error: "Transcription failed", trText });

    const data = JSON.parse(trText);
    const transcript = data.text;

    const qBody = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Você é um gerador de questionários."
        },
        {
          role: "user",
          content: `Gere ${num} perguntas de múltipla escolha (5 alternativas, 1 correta) com base neste texto: ${transcript}.`
        }
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
