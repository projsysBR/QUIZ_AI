import express from "express";
import fetch from "node-fetch";
import FormData from "form-data";
import multer from "multer";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";

const app = express();
app.use(express.json({ limit: "30mb" }));
const upload = multer();

const PORT = process.env.PORT || 10000;

function sniffContentType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return { ct: "application/pdf", ext: "pdf" };
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return { ct: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return { ct: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return { ct: "audio/webm", ext: "webm" };
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return { ct: "audio/mp4", ext: "m4a" };
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) {
    return { ct: "audio/wav", ext: "wav" };
  }
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
  const r = await fetchWithRetries(url, { redirect: "follow" });
  if (!r || !r.ok) throw new Error(`DIRECT_FETCH_${r?.status || 0}`);
  const serverCT = r.headers.get("content-type") || "";
  const buf = Buffer.from(await r.arrayBuffer());
  const sniff = sniffContentType(buf);
  const final = sniff
    || (serverCT.includes("application/pdf") ? { ct: "application/pdf", ext: "pdf" }
        : (serverCT.includes("webm") ? { ct: "audio/webm", ext: "webm" }
           : { ct: "audio/mpeg", ext: "mp3" }));
  return { buf, contentType: final.ct, ext: final.ext, serverCT };
}

async function transcribeAudioBuffer(buf, { contentType, ext }) {
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

function toUint8Array(maybe) {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(maybe)) {
    return new Uint8Array(maybe.buffer, maybe.byteOffset, maybe.byteLength);
  }
  if (maybe instanceof Uint8Array) {
    return new Uint8Array(maybe.buffer, maybe.byteOffset, maybe.byteLength);
  }
  if (maybe && maybe.buffer instanceof ArrayBuffer) return new Uint8Array(maybe.buffer);
  if (maybe instanceof ArrayBuffer) return new Uint8Array(maybe);
  return new Uint8Array(maybe);
}

async function extractPdfText(buf) {
  const data = toUint8Array(buf);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(i => i.str);
    text += strings.join(" ") + "\n";
  }
  return text.trim();
}

// Numbering
function prefixQuestionNumber(i, text) {
  const n = i + 1;
  const t = String(text || "").trim();
  if (/^\d+\./.test(t)) return t;
  return `${n}. ${t}`;
}
function prefixChoiceNumber(i, j, choice) {
  const n = i + 1;
  const c = String(choice || "").trim();
  if (/^\d+\.\d\)/.test(c)) return c;
  return `${n}.${j}) ${c}`;
}

async function generateQuizJSON(transcript, num) {
  const body = {
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.7,
    messages: [
      { role: "system", content: "Você é um gerador de questionários em português do Brasil. Responda APENAS JSON válido." },
      { role: "user", content:
        `Com base no conteúdo abaixo, gere ${num} perguntas de múltipla escolha em português do Brasil.
         Cada pergunta deve ter 5 alternativas (A, B, C, D, E) — todas em português — e apenas uma correta.
         O campo "answer_index" DEVE ser um número inteiro entre 0 e 4 que corresponde exatamente à alternativa correta em "choices".
         Retorne somente JSON no formato:
         {
           "questions": [
             { "number": 1,
               "text": "1. pergunta",
               "choices": ["1.0) alternativa A", "1.1) alternativa B", "1.2) alternativa C", "1.3) alternativa D", "1.4) alternativa E"],
               "answer_index": 0
             }
           ]
         }
         Número da questão e das alternativas devem seguir o padrão acima.
         Conteúdo: ${transcript}`
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

  const normalized = quiz.questions.map((q, i) => {
    const number = Number.isInteger(q?.number) ? q.number : i + 1;
    const text = prefixQuestionNumber(i, q?.text);
    let choices = Array.isArray(q?.choices) ? q.choices.slice(0, 5) : [];
    while (choices.length < 5) choices.push("");
    choices = choices.map((c, j) => prefixChoiceNumber(i, j, c));
    let answer_index = Number.isInteger(q?.answer_index) ? q.answer_index : 0;
    if (answer_index < 0 || answer_index > 4) answer_index = 0;
    return { number, text, choices, answer_index };
  });

  return { questions: normalized };
}

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/quiz-from-url", async (req, res) => {
  try {
    const rawUrl = (req.body?.url || "").trim();
    const num = Number(req.body?.num || 5);
    if (!rawUrl) return res.status(400).json({ error: "Informe 'url'" });
    const url = new URL(rawUrl).toString();

    const media = await bufferFromDirect(url);
    let transcript = "";

    if (media.contentType === "application/pdf" || media.serverCT.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
      transcript = await extractPdfText(media.buf);
    } else {
      transcript = await transcribeAudioBuffer(media.buf, { contentType: media.contentType, ext: media.ext });
    }

    const quiz = await generateQuizJSON(transcript, num);
    res.json(quiz);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/quiz-from-upload", upload.single("file"), async (req, res) => {
  try {
    const num = Number(req.body?.num || 5);
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: "Envie um arquivo no campo 'file' (multipart/form-data)" });

    const mimetype = req.file.mimetype || "";
    const name = (req.file.originalname || "").toLowerCase();

    let transcript = "";
    if (mimetype === "application/pdf" || name.endsWith(".pdf")) {
      transcript = await extractPdfText(req.file.buffer);
    } else {
      const extHint = name.split(".").pop();
      transcript = await transcribeAudioBuffer(req.file.buffer, { ext: extHint });
    }

    const quiz = await generateQuizJSON(transcript, num);
    res.json(quiz);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server v9.6 (numbered) running on ${PORT}`));
