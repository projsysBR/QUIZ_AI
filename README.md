# Render OpenAI Transcriber

Serviço Node.js pronto para o Render que:
1. Baixa o áudio de um vídeo (YouTube, Vimeo, ou URL direta).
2. Envia para a API de transcrição da OpenAI (gpt-4o-transcribe).
3. Gera questionário de múltipla escolha com base no texto transcrito.

## Uso

### Local
```bash
npm install
OPENAI_API_KEY=sk-XXX node index.js
```

### Requisição
```bash
curl -X POST https://seu-render-app.onrender.com/quiz-from-url   -H "Content-Type: application/json"   -d '{"url":"https://www.youtube.com/watch?v=XXXXXX","num":5}'
```

### Resposta
JSON contendo perguntas e respostas geradas.

---
**Importante:** o campo `file` é enviado com o MIME correto, evitando o erro *"Audio file might be corrupted or unsupported"*.
