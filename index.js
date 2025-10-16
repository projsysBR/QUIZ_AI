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

// -------- Helpers --------
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
  let resp;
  for (let i = 0; i < tries; i++) {
    try { resp = await fetch(url, options); } catch (e) { resp = null; }
    if (resp && resp.ok) return resp;
    const status = resp ? resp.status : 0;
    if (status === 429 || (status >= 500 && status < 600)) {
      const delay = Math.floor(baseDelay * Math.pow(2, i) * (1 + Math.random() * 0.25));
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (resp) return resp;
  }
  return resp;
}

async function bufferFromDirect(url) {
  const r = await fetchWithRetries(url, { headers: UA, redirect: "follow" });
  if (!r || !r.ok) throw new Error(`DIRECT_FETCH_${r?.status || 0}`);
  const serverCT = r.headers.get("content-type") || "";
  const buf = Buffer.from(await r.arrayBuffer());
  const sniff = sniffContentType(buf);
  const final = sniff || (serverCT.includes("webm") ? { ct: "audio/webm", ext: "webm" } : { ct: "audio/mpeg", ext: "mp3" });
  return { buf, contentType: final.ct, ext: final.ext };
}

async function transcribeBuffer(buf, { contentType, ext }) {
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("file", buf, { filename: `audio.${ext}`, contentType });

  const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  });
  const txt = await tr.text();
  if (!tr.ok) throw new Error(txt);
  const data = JSON.parse(txt);
  return data.text || "";
}

// -------- Fix helper to resolve correct answer index --------
function normalizeQuestion(q) {
  const out = {
    text: String(q?.text || "").trim(),
    choices: Array.isArray(q?.choices) ? q.choices.map(v => String(v || "")).map(s => s.trim()) : [],
    answer_index: Number.isInteger(q?.answer_index) ? q.answer_index : null
  };

  // Try common alternative fields
  if (out.answer_index == null) {
    const letter = String(q?.answer || q?.correct_letter || "").trim().toUpperCase();
    if (["A","B","C","D","E"].includes(letter)) {
      out.answer_index = ["A","B","C","D","E"].indexOf(letter);
    }
  }

  if (out.answer_index == null && typeof q?.correct === "number") {
    out.answer_index = q.correct;
  }

  if (out.answer_index == null && typeof q?.correct_choice === "string" && out.choices.length) {
    const idx = out.choices.findIndex(c => c.toLowerCase() === q.correct_choice.toLowerCase());
    if (idx >= 0) out.answer_index = idx;
  }

  // Detect asterisk or '(correta)' markers in choices
  if (out.answer_index == null && out.choices.length) {
    const idxStar = out.choices.findIndex(c => c.startsWith("*"));
    if (idxStar >= 0) {
      out.choices = out.choices.map(c => c.replace(/^[*\s]+/, "").replace(/\s*\(correta\)$/i, "").trim());
      out.answer_index = idxStar;
    } else {
      const idxTag = out.choices.findIndex(c => /(\[?correta\]?|\(correta\))/i.test(c));
      if (idxTag >= 0) {
        out.choices = out.choices.map(c => c.replace(/\s*(\[?correta\]?|\(correta\))/ig, "").trim());
        out.answer_index = idxTag;
      }
    }
  }

  // Clamp and fallback
  if (!Number.isInteger(out.answer_index) || out.answer_index < 0 || out.answer_index > 4) {
    out.answer_index = 0;
  }

  // Ensure 5 choices
  while (out.choices.length < 5) out.choices.push("");
  if (out.choices.length > 5) out.choices = out.choices.slice(0,5);

  return out;
}

async function generateQuizJSON(transcript, num) {
  const body = {
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.7,
    messages: [
      { role: "system", content: "Você é um gerador de questionários em português do Brasil. Responda APENAS JSON válido." },
      { role: "user", content:
        `Com base no texto abaixo, gere ${num} perguntas de múltipla escolha em português do Brasil.
         Cada pergunta deve ter 5 alternativas (A, B, C, D, E) — todas em português — e apenas uma correta.
         O campo "answer_index" DEVE ser um número inteiro entre 0 e 4 que corresponde exatamente à alternativa correta em "choices".
         NÃO repita 0 em todas. Varie conforme a resposta correta.
         Retorne APENAS um JSON com este formato:
         {
           "questions": [
             {"text": "pergunta em português",
              "choices": ["alternativa A","alternativa B","alternativa C","alternativa D","alternativa E"],
              "answer_index": 0}
           ]
         }
         Não inclua explicações fora do JSON.
         Texto original: ${transcript}`
      }
    ]
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const raw = await r.text();
  if (!r.ok) throw new Error(raw);
  const parsed = JSON.parse(raw);
  const content = parsed?.choices?.[0]?.message?.content || "{}";

  let quiz;
  try { quiz = JSON.parse(content); } catch { quiz = { questions: [] }; }
  if (!Array.isArray(quiz.questions)) quiz.questions = [];

  // Normalize and fix indices if needed
  quiz.questions = quiz.questions.map(normalizeQuestion);

  return quiz;
}

// -------- Routes --------
app.post("/quiz-from-url", async (req, res) => {
  try {
    const rawUrl = (req.body?.url || "").trim();
    const num = Number(req.body?.num || 5);
    if (!rawUrl) return res.status(400).json({ error: "Informe 'url'" });
    const url = new URL(rawUrl).toString();
    const media = await bufferFromDirect(url);
    const transcript = await transcribeBuffer(media.buf, { contentType: media.contentType, ext: media.ext });
    const quiz = await generateQuizJSON(transcript, num);
    res.json({ quiz });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/quiz-from-upload", upload.single("file"), async (req, res) => {
  try {
    const num = Number(req.body?.num || 5);
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: "Envie um arquivo no campo 'file' (multipart/form-data)" });
    const extHint = (req.file.originalname || "").split(".").pop();
    const transcript = await transcribeBuffer(req.file.buffer, { ext: extHint });
    const quiz = await generateQuizJSON(transcript, num);
    res.json({ quiz });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => console.log(`Server v8.1 running on ${PORT}`));
