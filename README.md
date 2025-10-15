# yt-vimeo-no-token

- `/quiz-from-url`: aceita YouTube, Vimeo (sem token, usando player config público) e URLs diretas de mídia.
- Limite padrão: 20MB para o buffer, ajuste `MAX` no código.
- Env var: `OPENAI_API_KEY`.

**Atenção:** o caminho Vimeo sem token só funciona quando o dono do vídeo permite **progressive MP4** no player.
Se o vídeo estiver apenas em HLS (`.m3u8`) não é suportado sem ffmpeg.
