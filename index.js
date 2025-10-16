import express from "express";
import fetch from "node-fetch";
import ytdl from "@distube/ytdl-core";
import FormData from "form-data";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;
const MAX = 25 * 1024 * 1024; // 25MB

// ---------- ENV / Config ----------
const UA = { "User-Agent": "Mozilla/5.0" };
const YT_FALLBACK_BASE = process.env.YT_FALLBACK_BASE || ""; // ex: https://yt-proxy.example.com/api/mp3?url=
const YT_FALLBACK_AUTH = process.env.YT_FALLBACK_AUTH || ""; // ex: Bearer xxx (opcional)

// ---------- Helpers ----------
function isYouTube(url) { return /youtube\.com|youtu\.be/.test(url); }
function hexHead(buf, n=20){ return buf.slice(0, n).toString("hex"); }

// Sniffer simples por magic bytes
function sniffContentType(buf) {
  if (!buf || buf.length < 12) return null;
  // MP3
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return { ct: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return { ct: "audio/mpeg", ext: "mp3" };
  // WEBM
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return { ct: "audio/webm", ext: "webm" };
  // WAV
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45)
    return { ct: "audio/wav", ext: "wav" };
  // MP4/M4A
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return { ct: "audio/mp4", ext: "m4a" };
  // HLS playlist (#EXTM3U)
  if (buf[0] === 0x23 && buf[1] === 0x45 && buf[2] === 0x58 && buf[3] === 0x54 && buf[4] === 0x4D && buf[5] === 0x33 && buf[6] === 0x55) return { ct: "application/vnd.apple.mpegurl", ext: "m3u8" };
  // HTML
  const head = buf.slice(0, 15).toString("utf8").toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return { ct: "text/html", ext: "html" };
  return null;
}

async function fetchWithRetries(url, options, { tries = 5, baseDelay = 600 } = {}) {
  let lastErr, resp;
  for (let i = 0; i < tries; i++) {
    try { resp = await fetch(url, options); } catch (e) { lastErr = e; resp = null; }
    if (resp && resp.ok) return resp;
    const status = resp ? resp.status : 0;
    const retryAfter = resp?.headers?.get("retry-after");
    if (status === 429 || (status >= 500 && status < 600)) {
      const delay = retryAfter ? Math.ceil(parseFloat(retryAfter) * 1000)
        : Math.floor(baseDelay * Math.pow(2, i) * (1 + Math.random() * 0.25));
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (resp) return resp; // 4xx que não é 429
  }
  if (resp) return resp;
  throw lastErr || new Error("NETWORK_ERROR");
}

// ---------- YouTube ----------
async function ytdlToBuffer(url, { maxBytes = MAX } = {}) {
  const info = await ytdl.getInfo(url, { requestOptions: { headers: UA } });
  const formats = ytdl.filterFormats(info.formats, "audioonly")
    .sort((a,b) => (b.audioBitrate||0) - (a.audioBitrate||0));
  const fmt = formats[0];
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
  if (!sniff || sniff.ct === "text/html" || sniff.ext === "html" || sniff.ext === "m3u8") {
    throw new Error("YTDL_INVALID_BYTES");
  }
  return { buf, contentType: sniff.ct, ext: sniff.ext };
}

// ---------- Fallback externo ----------
// Espera que seu serviço (YT_FALLBACK_BASE) retorne JSON: { download_url, content_type? }
async function youtubeFallback(url, { maxBytes = MAX } = {}) {
  if (!YT_FALLBACK_BASE) throw new Error("YT_FALLBACK_NOT_CONFIGURED");
  const q = YT_FALLBACK_BASE + encodeURIComponent(url);
  const headers = { ...UA };
  if (YT_FALLBACK_AUTH) headers["Authorization"] = YT_FALLBACK_AUTH;
  const r = await fetchWithRetries(q, { headers }, { tries: 3, baseDelay: 500 });
  if (!r.ok) throw new Error(`YT_FALLBACK_UPSTREAM_${r.status}`);
  const meta = await r.json();
  if (!meta.download_url) throw new Error("YT_FALLBACK_NO_URL");
  const r2 = await fetchWithRetries(meta.download_url, { headers: UA }, { tries: 3, baseDelay: 500 });
  if (!r2.ok) throw new Error(`YT_FALLBACK_DOWNLOAD_${r2.status}`);
  const ct = (r2.headers.get("content-type") || meta.content_type || "");
  const buf = Buffer.from(await r2.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("AUDIO_TOO_LARGE");
  const sniff = sniffContentType(buf);
  if (!sniff || !sniff.ct.startsWith("audio/")) throw new Error("YT_FALLBACK_INVALID_BYTES");
  return { buf, contentType: sniff.ct, ext: sniff.ext };
}

// ---------- Direct URL ----------
async function bufferFromDirect(url, { maxBytes = MAX } = {}) {
  const r = await fetchWithRetries(url, { headers: UA, redirect: "follow" }, { tries: 2, baseDelay: 400 });
  if (!r.ok) throw new Error(`DIRECT_FETCH_${r.status}`);
  const serverCT = (r.headers.get("content-type") || "");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("AUDIO_TOO_LARGE");
  const sniff = sniffContentType(buf);
  if (sniff && (sniff.ext === "html" || sniff.ext === "m3u8")) {
    if (sniff.ext === "html") throw new Error("DIRECT_RETURNED_HTML_NOT_MEDIA");
    if (sniff.ext === "m3u8") throw new Error("HLS_M3U8_NOT_SUPPORTED_USE_DIRECT_MEDIA");
  }
  if (!(sniff && sniff.ct.startsWith("audio/")) && !serverCT.startsWith("audio/")) {
    throw new Error("UNRECOGNIZED_MEDIA_BYTES");
  }
  const final = sniff && sniff.ct.startsWith("audio/") ? sniff :
    (serverCT.includes("webm") ? { ct: "audio/webm", ext: "webm" } :
     serverCT.includes("mp4") ? { ct: "audio/mp4", ext: "m4a" } :
     { ct: "audio/mpeg", ext: "mp3" });
  return { buf, contentType: final.ct, ext: final.ext };
}

// ---------- OpenAI ----------
async function transcribeBuffer(buf, { contentType, ext }) {
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("file", buf, { filename: `media.${ext}`, contentType });

  const tr = await fetchWithRetries("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  }, { tries: 4, baseDelay: 700 });

  const trText = await tr.text();
  if (!tr.ok) {
    const passStatus = tr.status === 429 ? 429 : 500;
    const resp = { error: "Transcription failed", upstream_status: tr.status, trText };
    throw Object.assign(new Error("OPENAI_TRANSCRIPTION_FAILED"), { status: passStatus, details: resp });
  }
  const data = JSON.parse(trText);
  return data.text || "";
}

// ---------- Routes ----------
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/quiz-from-url", async (req, res) => {
  try {
    const { url, num = 5 } = req.body || {};
    if (!url) return res.status(400).json({ error: "Informe 'url'" });

    let media;
    if (isYouTube(url)) {
      try {
        media = await ytdlToBuffer(url);
      } catch (err) {
        // Se tomou 429 do YouTube, usa o fallback externo (se configurado)
        const msg = (err && (err.statusCode || err.code || err.message)) || "YTDL_ERROR";
        const is429 = (''+msg).includes("429") || (err && err.statusCode === 429);
        if (is429) {
          if (!YT_FALLBACK_BASE) throw new Error("YTDL_429_AND_NO_FALLBACK_CONFIGURED");
          media = await youtubeFallback(url);
        } else {
          throw err;
        }
      }
    } else {
      media = await bufferFromDirect(url);
    }

    const transcript = await transcribeBuffer(media.buf, { contentType: media.contentType, ext: media.ext });

    // Gera quiz
    const qBody = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é um gerador de questionários." },
        { role: "user", content: `Gere ${num} perguntas de múltipla escolha (5 alternativas, 1 correta) com base neste texto: ${transcript}.` }
      ]
    };

    const qResp = await fetchWithRetries("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(qBody)
    }, { tries: 3, baseDelay: 600 });

    const qDataText = await qResp.text();
    if (!qResp.ok) return res.status(qResp.status).json({ error: "Quiz generation failed", upstream_status: qResp.status, body: qDataText });

    const qData = JSON.parse(qDataText);
    return res.json(qData);
  } catch (e) {
    console.error(e);
    const status = e.status || 400;
    const payload = e.details || { error: e.message || "UNKNOWN_ERROR" };
    return res.status(status).json(payload);
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
