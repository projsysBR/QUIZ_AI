# Quiz API v8.1 (PT-BR, answer_index fix)
- Gera perguntas/alternativas em PT-BR
- Força e valida `answer_index` (0..4) por questão, com várias heurísticas de correção (letra A-E, campo `correct`, marcador `*`, tag "(correta)" etc.).
- Retorno:
{ "quiz": { "questions": [ { "text": "...", "choices": ["A","B","C","D","E"], "answer_index": 0 } ] } }

Rotas:
- POST /quiz-from-url  (JSON { url, num })
- POST /quiz-from-upload  (multipart { file, num })

Env:
- OPENAI_API_KEY (obrigatório)
- PORT=10000 (opcional)
