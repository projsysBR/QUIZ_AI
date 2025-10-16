# Quiz API v7 (Render)
Retorna **JSON estruturado** para o Bubble no formato:
```json
{ "quiz": { "questions": [ { "text": "...", "choices": ["A","B","C","D","E"], "answer_index": 0 } ] } }
```

## Rotas
- `POST /quiz-from-url` — body JSON: `{ "url": "<https://...>", "num": 5 }`
- `POST /quiz-from-upload` — multipart: `file=@audio.mp3`, `num=5`

## Env vars
- `OPENAI_API_KEY` (obrigatória)
- `PORT=10000` (opcional)

## Teste
```
curl -X POST http://localhost:10000/quiz-from-url -H "Content-Type: application/json" -d '{"url":"https://.../video.mp4","num":3}'
```
