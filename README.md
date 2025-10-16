# Quiz API v9.1 (pdfjs-dist)
- Suporte a **PDF** com `pdfjs-dist` (sem arquivos de teste)
- Suporte a áudio (mp3/m4a/webm/wav)
- Gera quiz em português do Brasil

Rotas:
- POST /quiz-from-url  { url, num }
- POST /quiz-from-upload  (multipart { file, num })
