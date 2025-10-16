import express from "express";
import fetch from "node-fetch";
import ytdl from "@distube/ytdl-core";
import FormData from "form-data";
import multer from "multer";

const app = express();
app.use(express.json());
const upload = multer(); // memoria

const PORT = process.env.PORT || 10000;

// -------- Helpers --------
function sniffContentType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return { ct: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return { ct: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return { ct: "audio/webm", ext: "webm" };
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) return { ct: "audio/wav", ext: "wav" };
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return { ct: "audio/mp4", ext: "m4a" };
  return null;
}

async function fetchWithRetries(url, options, { tries = 4, baseDelay = 600 } = {}) {
  let resp;
  for (let i = 0; i < tries; i++) {
    try { resp = await fetch(url, options); } catch (e) { resp = null; }
    if (resp && resp.ok) return resp;
    const status = resp ? resp.status : 0;
    const retryAfter = resp?.headers?.get("retry-after");
    if (status === 429 || (status >= 500 && status < 600)) {
      const delay = retryAfter ? Math.ceil(parseFloat(retryAfter) * 1000) : Math.floor(baseDelay * Math.pow(2, i) * (1 + Math.random() * 0.25));
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (resp) return resp;
  }
  return resp;
}

async function transcribeBuffer(buf, extHint) {
  const sniff = sniffContentType(buf);
  const ext = sniff?.ext || extHint || "mp3";
  const ct  = sniff?.ct  || (ext === "webm" ? "audio/webm" : ext === "m4a" ? "audio/mp4" : ext === "wav" ? "audio/wav" : "audio/mpeg");

  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("file", buf, { filename: `media.${ext}`, contentType: ct });

  const tr = await fetchWithRetries("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  });

  const trText = await tr.text();
  if (!tr || !tr.ok) {
    const pass = tr?.status === 429 ? 429 : 500;
    throw Object.assign(new Error("OPENAI_TRANSCRIPTION_FAILED"), { status: pass, details: trText });
  }
  return JSON.parse(trText).text || "";
}

// --------- NOVA ROTA: upload de arquivo ---------
app.post("/quiz-from-upload", upload.single("file"), async (req, res) => {
  try {
    const num = Number(req.body?.num || 5);
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: "Envie um arquivo no campo 'file' (multipart/form-data)" });

    const transcript = await transcribeBuffer(req.file.buffer, (req.file.originalname||"").split(".").pop());
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
    });
    const body = await qResp.text();
    if (!qResp || !qResp.ok) return res.status(qResp?.status || 500).json({ error: "Quiz generation failed", body });
    return res.json(JSON.parse(body));
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message, details: e.details || "" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
