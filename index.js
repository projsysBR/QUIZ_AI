import express from "express";
import fetch from "node-fetch";
import FormData from "form-data";
import multer from "multer";

const app = express();
app.use(express.json({ limit: "30mb" }));
const upload = multer();

const PORT = process.env.PORT || 10000;
const UA = { "User-Agent": "Mozilla/5.0" };
const MAX = 25 * 1024 * 1024;

// Utils
function sniffContentType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return { ct: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return { ct: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return { ct: "audio/webm", ext: "webm" };
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return { ct: "audio/mp4", ext: "m4a" };
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) return { ct: "audio/wav", ext: "wav" };
  const head = buf.slice(0, 15).toString("utf8").toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return { ct: "text/html", ext: "html" };
  return null;
}

async function fetchWithRetries(url, options, { tries = 4, baseDelay = 600 } = {}) {
  let resp, lastErr;
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
    if (resp) return resp;
  }
  if (resp) return resp;
  throw lastErr || new Error("NETWORK_ERROR");
}

async function bufferFromDirect(url, { maxBytes = MAX } = {}) {
  const r = await fetchWithRetries(url, { headers: UA, redirect: "follow" });
  if (!r || !r.ok) throw new Error(`DIRECT_FETCH_${r?.status || 0}`);
  const serverCT = r.headers.get("content-type") || "";
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("AUDIO_TOO_LARGE");
  const sniff = sniffContentType(buf);
  if (sniff && (sniff.ext === "html")) throw new Error("DIRECT_RETURNED_HTML_NOT_MEDIA");
  const final = sniff && sniff.ct.startsWith("audio/")
    ? sniff
    : (serverCT.includes("webm") ? { ct: "audio/webm", ext: "webm" }
      : serverCT.includes("mp4") ? { ct: "audio/mp4", ext: "m4a" }
      : serverCT.includes("wav") ? { ct: "audio/wav", ext: "wav" }
      : { ct: "audio/mpeg", ext: "mp3" });
  return { buf, contentType: final.ct, ext: final.ext };
}

async function transcribeBuffer(buf, { contentType, ext }) {
  const sniff = sniffContentType(buf);
  const ct = sniff?.ct || contentType || "audio/mpeg";
  const ex = sniff?.ext || ext || "mp3";

  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("file", buf, { filename: `media.${ex}`, contentType: ct });

  const tr = await fetchWithRetries("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  }, { tries: 4, baseDelay: 700 });

  const txt = await tr.text();
  if (!tr.ok) {
    const status = tr.status === 429 ? 429 : 500;
    throw Object.assign(new Error("OPENAI_TRANSCRIPTION_FAILED"), { status, details: txt });
  }
  const data = JSON.parse(txt);
  return data.text || "";
}

async function generateQuizJSON(transcript, num) {
  const body = {
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Você gera questionários. Responda apenas JSON válido." },
      { role: "user", content:
        `A partir do texto a seguir, gere ${num} perguntas de múltipla escolha.
         Cada pergunta deve ter 5 alternativas (A..E) e apenas 1 correta.
         Retorne APENAS um JSON com o formato exato:
         {
           "questions": [
             {"text": "...", "choices": ["A","B","C","D","E"], "answer_index": 0}
           ]
         }
         Texto: ${transcript}`
      }
    ]
  };

  const r = await fetchWithRetries("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, { tries: 3, baseDelay: 600 });

  const raw = await r.text();
  if (!r.ok) throw new Error(`OPENAI_QUIZ_FAILED_${r.status}: ${raw}`);

  const parsed = JSON.parse(raw);
  const content = parsed?.choices?.[0]?.message?.content || "{}";
  let quiz;
  try { quiz = JSON.parse(content); } catch { quiz = { questions: [] }; }
  if (!quiz.questions || !Array.isArray(quiz.questions)) quiz.questions = [];
  quiz.questions = quiz.questions.map(q => ({
    text: String(q?.text || "").trim(),
    choices: Array.isArray(q?.choices) ? q.choices.map(String) : [],
    answer_index: Number.isInteger(q?.answer_index) ? q.answer_index : 0
  }));
  return quiz;
}

// Routes
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/quiz-from-url", async (req, res) => {
  try {
    const rawUrl = (req.body?.url || "").trim();
    const num = Number(req.body?.num || 5);
    if (!rawUrl) return res.status(400).json({ error: "Informe 'url'" });
    let url;
    try { url = new URL(rawUrl).toString(); } catch { url = new URL(encodeURI(rawUrl)).toString(); }

    const media = await bufferFromDirect(url);
    const transcript = await transcribeBuffer(media.buf, { contentType: media.contentType, ext: media.ext });
    const quiz = await generateQuizJSON(transcript, num);
    return res.json({ quiz });
  } catch (e) {
    const status = e.status || 400;
    return res.status(status).json({ error: e.message || "ERROR", details: e.details || "" });
  }
});

app.post("/quiz-from-upload", upload.single("file"), async (req, res) => {
  try {
    const num = Number(req.body?.num || 5);
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: "Envie um arquivo no campo 'file' (multipart/form-data)" });

    const extHint = (req.file.originalname || "").split(".").pop();
    const transcript = await transcribeBuffer(req.file.buffer, { ext: extHint });
    const quiz = await generateQuizJSON(transcript, num);
    return res.json({ quiz });
  } catch (e) {
    const status = e.status || 400;
    return res.status(status).json({ error: e.message || "ERROR", details: e.details || "" });
  }
});

app.listen(PORT, () => console.log(`Server v7 running on ${PORT}`));
