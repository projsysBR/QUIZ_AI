# v6 — Upload Direto (multipart)

Evita bloqueios do YouTube/Vimeo. Envie o **arquivo** de áudio/vídeo diretamente do Bubble para a rota:

`POST /quiz-from-upload` (multipart/form-data)

Campos:
- `file` (arquivo) — mp3, m4a, webm, wav
- `num` (opcional) — quantidade de perguntas

Exemplo cURL:
```bash
curl -X POST https://SEU-APP-RENDER.onrender.com/quiz-from-upload   -H "Authorization: Bearer SEU_TOKEN_SE_EXISTIR"   -F "file=@/caminho/audio.mp3"   -F "num=5"
```

No Bubble (API Connector):
- Method: POST
- Body type: form-data
- Key `file`: tipo **File**
- Key `num`: tipo **Text/Number**
- NÃO definir manualmente o Content-Type (o Bubble define multipart).
