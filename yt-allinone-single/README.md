# yt-allinone-single

Único endpoint que faz **transcrição + geração de questões** a partir de uma URL do YouTube.

## Endpoint
`POST /quiz-from-youtube`

Body:
```json
{ "url": "https://www.youtube.com/watch?v=XXXXXXX", "num": 5 }
```

## Deploy no Render
- Build: `npm install`
- Start: `node index.js`
- Env Var: `OPENAI_API_KEY=sk-...`
- CORS liberado (ajuste em produção).

### Observações
- Limite de duração padrão: 15min (ajustável).
- Limite de buffer: 20MB (ajuste `MAX`).
- Use apenas com conteúdo que você tenha direito de processar.
