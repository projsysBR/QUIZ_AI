# yt-allinone-fixed

Rota única que faz **transcrição + geração de questões** a partir de uma URL do YouTube.
Corrige o erro 410 usando **ytdl-core** (stream) + **buffer** antes de enviar à OpenAI.

## Endpoint
`POST /quiz-from-youtube`

Body:
```json
{ "url": "https://www.youtube.com/watch?v=XXXXXXX", "num": 5 }
```

## Render
- Build: `npm install`
- Start: `node index.js`
- Env Var: `OPENAI_API_KEY=sk-...`
