# Quiz API v9 (Áudio + PDF, PT-BR)
Aceita **áudio (mp3/m4a/webm/wav)** e **PDF** tanto por URL quanto por upload e gera quiz em português do Brasil.

## Rotas
- `POST /quiz-from-url` — body JSON: `{ "url": "<https://...>", "num": 5 }`
  - Detecta automaticamente se a URL aponta para **PDF** ou **áudio**.
- `POST /quiz-from-upload` — multipart: `file=@arquivo` + `num=5`
  - Detecta automaticamente se o arquivo é **PDF** ou **áudio**.

## Env vars
- `OPENAI_API_KEY` (obrigatória)
- `PORT=10000` (opcional)
