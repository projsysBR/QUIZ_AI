# yt-vimeo-direct

Rota única `/quiz-from-url` que aceita:
- **YouTube** (usa ytdl-core com retry)
- **Vimeo** (via API oficial com VIMEO_TOKEN)
- **URLs diretas de áudio/vídeo** (mp3/mp4/m4a/webm)

### Env Vars
- OPENAI_API_KEY=sk-...
- (opcional) VIMEO_TOKEN=token_vimeo

### Exemplo de uso
POST /quiz-from-url
{
  "url": "https://www.youtube.com/watch?v=XXXXXXX",
  "num": 5
}
