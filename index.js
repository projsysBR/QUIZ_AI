import express from "express";
import fetch from "node-fetch";
import ytdl from "ytdl-core";
import FormData from "form-data";

const app = express();
app.use(express.json());

// CORS liberado
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Healthcheck
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "yt-allinone-retry", uptime: process.uptime() });
});

// Função com retry
async function streamToBufferWithRetry(url, { maxBytes = 20 * 1024 * 1024, retries = 2 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      const audioStream = ytdl(url, {
        quality: "highestaudio",
        filter: "audioonly",
        highWaterMark: 1 << 25,
        requestOptions: {
          headers: {
            "user-agent": "Mozilla/5.0",
            "accept-language": "en-US,en;q=0.9"
          }
        }
      });

      const chunks = [];
      let size = 0;
      await new Promise((resolve, reject) => {
        audioStream.on("data", (d) => {
          size += d.length;
          if (size > maxBytes) {
            audioStream.destroy();
            return reject(new Error("AUDIO_TOO_LARGE"));
          }
          chunks.push(d);
        });
        audioStream.on("end", resolve);
        audioStream.on("error", (e) => reject(e));
      });

      return Buffer.concat(chunks);
    } catch (e) {
      const msg = String(e || "");
      const retriable = /Status code:\s?(410|403|404)/.test(msg);
      if (!retriable || attempt >= retries) throw e;
      attempt += 1;
      await new Promise(r => setTimeout(r, 700 * attempt));
    }
  }
}

app.post("/quiz-from-youtube", async (req, res) => {
  try {
    const { url, num = 5 } = req.body || {};
    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: "URL inválida do YouTube" });
    }

    let info;
    try {
      info = await ytdl.getInfo(url);
      const lengthSec = parseInt(info.videoDetails.lengthSeconds || "0", 10);
      if (lengthSec > 900) {
        return res.status(413).json({ error: "Vídeo muito longo (> 15 min)" });
      }
    } catch {}

    const MAX = 20 * 1024 * 1024;
    const buf = await streamToBufferWithRetry(url, { maxBytes: MAX, retries: 2 });

    const form = new FormData();
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("file", buf, { filename: "yt.mp3", contentType: "audio/mpeg" });

    const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const trText = await tr.text();
    if (!tr.ok) return res.status(tr.status).type("application/json").send(trText);

    let transcript = "";
    try { transcript = (JSON.parse(trText).text || "").toString(); } catch {}

    const prompt = `Gere ${num} questões de múltipla escolha sobre o texto a seguir.
Cada questão deve ter 5 alternativas (A, B, C, D, E), com exatamente 1 correta.
Retorne APENAS JSON válido.
Texto:
${transcript}`;

    const body = {
      model: "o3-mini",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "Você é um gerador de provas. Responda apenas em JSON válido." },
          { type: "input_text", text: prompt }
        ]
      }]
    };

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const respText = await resp.text();
    let questionsPayload = null;
    try {
      const parsed = JSON.parse(respText);
      const textOut = parsed.output_text || parsed.output || respText;
      try {
        questionsPayload = typeof textOut === "string" ? JSON.parse(textOut) : textOut;
      } catch {
        questionsPayload = parsed;
      }
    } catch {}

    return res.status(200).json({
      transcript,
      questions: questionsPayload?.questions || questionsPayload || respText
    });

  } catch (e) {
    if (String(e).includes("AUDIO_TOO_LARGE")) {
      return res.status(413).json({ error: "Áudio muito grande (> 20 MB). Tente um vídeo menor." });
    }
    return res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`yt-allinone-retry listening on :${PORT}`));
