# Render OpenAI Transcriber v3

Versão com *sniffer* de formato para garantir que o `file` enviado à OpenAI tenha **bytes, extensão e MIME consistentes**.

## Deploy
- `npm install`
- `OPENAI_API_KEY=sk-*** node index.js`

## Teste
```
curl -X POST http://localhost:3000/quiz-from-url   -H "Content-Type: application/json"   -d '{"url":"https://www.youtube.com/watch?v=XXXX","num":5}'
```
