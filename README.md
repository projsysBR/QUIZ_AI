# Quiz API v8 (PT-BR)
Retorna perguntas e alternativas em **português do Brasil**, no formato:
```json
{ "quiz": { "questions": [ { "text": "...", "choices": ["A","B","C","D","E"], "answer_index": 0 } ] } }
```

## Rotas
- `POST /quiz-from-url` — body JSON: `{ "url": "<https://...>", "num": 5 }`
- `POST /quiz-from-upload` — multipart: `file=@audio.mp3`, `num=5`

## Env vars
- `OPENAI_API_KEY` (obrigatória)
- `PORT=10000` (opcional)
