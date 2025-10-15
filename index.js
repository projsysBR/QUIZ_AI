import express from "express";
import fetch from "node-fetch";
import ytdl from "ytdl-core";
import FormData from "form-data";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (_req, res) => res.json({ ok: true, service: "yt-vimeo-no-token", uptime: process.uptime() }));

const MAX = 20 * 1024 * 1024;
const UA = { "user-agent": "Mozilla/5.0", "accept-language": "en-US,en;q=0.9" };

function isYouTube(u) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return ["youtube.com", "youtu.be"].some(x => h.endsWith(x));
  } catch { return false; }
}
function isVimeo(u) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return h.endsWith("vimeo.com");
  } catch { return false; }
}
function isLikelyDirectMedia(ct) {
  return /^audio\//i.test(ct || "") || /^video\//i.test(ct || "");
}

// YouTube with retry
async function bufferFromYouTubeWithRetry(url, { maxBytes = MAX, retries = 3 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      const audio = ytdl(url, {
        quality: "highestaudio",
        filter: "audioonly",
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
      return Buffer.concat(chunks);
    } catch (e) {
      const msg = String(e || "");
      const retriable = /Status code:\s?(410|403|404|429)/.test(msg);
      if (!retriable || attempt >= retries) throw e;
      attempt++;
      await new Promise(r => setTimeout(r, 800 * attempt));
    }
  }
}

// Vimeo sem token: usa player config público (se o dono permitir progressive)
async function bufferFromVimeoNoToken(url, { maxBytes = MAX } = {}) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const id = parts.pop();
  if (!/^\d+$/.test(id)) throw new Error("VIMEO_ID_NOT_FOUND");

  const cfg = await fetch(`https://player.vimeo.com/video/${id}/config`, { headers: UA });
  if (!cfg.ok) throw new Error(`VIMEO_CFG_${cfg.status}`);
  const data = await cfg.json();

  // caminhos possíveis (varia por conta/plano do vídeo)
  // 1) arquivos progressivos em data.request.files.progressive
  let prog = (data?.request?.files?.progressive) || [];
  // 2) alguns retornam em data.request.files.hls (apenas m3u8 -> não suportamos sem ffmpeg)
  if (!Array.isArray(prog) || !prog.length) {
    throw new Error("VIMEO_NO_PROGRESSIVE_MP4");
  }

  // escolhe maior qualidade disponível
  prog.sort((a,b) => (b.height||0) - (a.height||0));
  const best = prog[0]?.url;
  if (!best) throw new Error("VIMEO_NO_URL");

  const r = await fetch(best, { headers: UA });
  if (!r.ok) throw new Error(`VIMEO_FETCH_${r.status}`);
  const ct = (r.headers.get("content-type") || "");
  if (!isLikelyDirectMedia(ct)) throw new Error(`VIMEO_UNSUPPORTED_CT_${ct}`);

  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("AUDIO_TOO_LARGE");
  return buf;
}

// Direct URL
async function bufferFromDirect(url, { maxBytes = MAX } = {}) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`DIRECT_FETCH_${r.status}`);
  const ct = (r.headers.get("content-type") || "");
  if (!isLikelyDirectMedia(ct)) throw new Error(`DIRECT_UNSUPPORTED_CT_${ct}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("AUDIO_TOO_LARGE");
  return buf;
}

app.post("/quiz-from-url", async (req, res) => {
  try {
    const { url, num = 5 } = req.body || {};
    if (!url) return res.status(400).json({ error: "Informe 'url'" });

    let buf;
    if (isYouTube(url)) buf = await bufferFromYouTubeWithRetry(url);
    else if (isVimeo(url)) buf = await bufferFromVimeoNoToken(url);
    else buf = await bufferFromDirect(url);

    // Transcrição
    const form = new FormData();
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("file", buf, { filename: "media.mp3", contentType: "audio/mpeg" });

    const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const trText = await tr.text();
    if (!tr.ok) return res.status(tr.status).type("application/json").send(trText);

    let transcript = "";
    try { transcript = (JSON.parse(trText).text || "").toString(); } catch {}
    if (!transcript) return res.status(200).json({ transcript: trText, questions: [] });

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
      const out = parsed.output_text || parsed.output || respText;
      questionsPayload = typeof out === "string" ? JSON.parse(out) : out;
    } catch { questionsPayload = respText; }

    return res.status(200).json({ transcript, questions: questionsPayload?.questions || questionsPayload || respText });

  } catch (e) {
    const msg = String(e || "");
    if (msg.includes("AUDIO_TOO_LARGE")) return res.status(413).json({ error: "Mídia muito grande (>20MB)." });
    return res.status(500).json({ error: msg });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`yt-vimeo-no-token listening on :${PORT}`));
