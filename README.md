# Quiz API v9.2 (pdfjs)
- Corrige condição WAV (troca 'and' por '&&')
- Suporte a PDF com pdfjs-dist
- Suporte a áudio (mp3/m4a/webm/wav)
- Gera quiz em português do Brasil

Rotas:
- POST /quiz-from-url  { url, num }
- POST /quiz-from-upload  (multipart { file, num })
