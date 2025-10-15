# yt-allinone-retry

Versão com retry automático em caso de erro 410, 403 ou 404 no download de áudio.
Rota única para transcrição e geração de questões a partir de um vídeo do YouTube.

## Endpoint
POST /quiz-from-youtube

Body:
{
  "url": "https://www.youtube.com/watch?v=XXXXXXX",
  "num": 5
}

## Deploy
- Build: npm install
- Start: node index.js
- Env Var: OPENAI_API_KEY=sk-...
