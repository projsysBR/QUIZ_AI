import express from "express";
import fetch from "node-fetch";
import ytdl from "ytdl-core";
import FormData from "form-data";

const app = express();
app.use(express.json());

// CORS liberado para testes (ajuste para seu domínio em produção)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "yt-allinone-single", uptime: process.uptime() });
});

/**
 * POST /quiz-from-youtube
 * Body: { "url": "https://www.youtube.com/watch?v=...", "num": 5 }
 * - Pega melhor faixa de áudio via ytdl
 * - Baixa para buffer (até ~20MB por padrão)
 * - Transcreve na OpenAI
 * - Gera N questões de múltipla escolha (5 alternativas, 1 correta)
 * Retorna: { transcript, questions }
 */
app.post("/quiz-from-youtube", async (req, res) => {
  try {
    const { url, num = 5 } = req.body || {};
    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: "URL inválida do YouTube" });
    }

    // 1) Info do vídeo e limite de duração
    const info = await ytdl.getInfo(url);
    const lengthSec = parseInt(info.videoDetails.lengthSeconds || "0", 10);
    if (lengthSec > 900) {
      return res.status(413).json({ error: "Vídeo muito longo (> 15 min). Use um vídeo menor." });
    }

    // 2) Melhor faixa de áudio
    const formats = ytdl.filterFormats(info.formats, "audioonly")
      .filter(f => f.url && (f.mimeType || "").includes("audio"))
      .sort((a,b) => (b.audioBitrate||0) - (a.audioBitrate||0));
    if (!formats.length) return res.status(415).json({ error: "Não encontrei faixa de áudio" });
    const best = formats[0];

    // 3) Baixar para buffer (estável, evita ECONNRESET)
    const MAX = 20 * 1024 * 1024; // 20MB
    const audioRes = await fetch(best.url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!audioRes.ok) return res.status(400).json({ error: `Falha ao baixar áudio (${audioRes.status})` });
    const type = (audioRes.headers.get("content-type") || "audio/mpeg").split(";")[0];
    const buf = Buffer.from(await audioRes.arrayBuffer());
    if (buf.byteLength > MAX) {
      return res.status(413).json({ error: `Áudio muito grande (${(buf.byteLength/1024/1024).toFixed(1)} MB)` });
    }

    // 4) Transcrever
    const form = new FormData();
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("file", buf, { filename: `yt.${type.split("/")[1]||"mp3"}`, contentType: type });

    const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const trText = await tr.text();
    if (!tr.ok) return res.status(tr.status).type("application/json").send(trText);

    let transcript = "";
    try {
      const parsed = JSON.parse(trText);
      transcript = (parsed.text || parsed.transcript || "").toString();
    } catch { /* keep empty */ }
    if (!transcript) return res.status(200).json({ transcript: trText, questions: [] });

    // 5) Questões
    const prompt = `Gere ${num} questões de múltipla escolha sobre o texto a seguir.
Cada questão deve ter 5 alternativas (A, B, C, D, E), com exatamente 1 correta.
Retorne APENAS JSON válido:
{
  "questions": [
    { "pergunta": "...",
      "alternativas": ["A) ...","B) ...","C) ...","D) ...","E) ..."],
      "correta": "B"
    }
  ]
}
Texto:
${transcript}
`;

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
    } catch { /* leave as text */ }

    return res.status(200).json({
      transcript,
      questions: questionsPayload?.questions || questionsPayload || respText
    });

  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`yt-allinone-single listening on :${PORT}`);
});
