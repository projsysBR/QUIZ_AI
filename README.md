# Render OpenAI Transcriber v2

Versão corrigida com fallback de MIME seguro (audio/mpeg) para evitar erro "Unsupported file format bin".

## Instalação
```bash
npm install
```

## Execução
```bash
OPENAI_API_KEY=sk-XXX node index.js
```

## Teste rápido
```bash
curl -X POST https://seu-render-app.onrender.com/quiz-from-url   -H "Content-Type: application/json"   -d '{"url":"https://www.youtube.com/watch?v=XXXXXX","num":5}'
```

Retorna JSON com perguntas geradas.
