# Render OpenAI Transcriber v5 (com fallback YouTube)

Esta versão adiciona:
- **Fallback externo** quando o YouTube retorna 429 no `ytdl-core`.
- **Retries** e propagação adequada de erros 429 da OpenAI.
- Sniffer de formato para garantir que o `file` enviado à OpenAI seja válido (MP3/M4A/WEBM/WAV).
- Rota `/health` para verificação.

## Variáveis de ambiente
- `OPENAI_API_KEY` — sua chave da OpenAI (obrigatória).
- `YT_FALLBACK_BASE` — base URL do seu serviço proxy de conversão YouTube→MP3/áudio.
  - Ex.: `https://yt-proxy.suaempresa.com/api/mp3?url=`
  - O serviço deve responder JSON: `{ "download_url": "https://..." , "content_type": "audio/mpeg" }`
- `YT_FALLBACK_AUTH` — (opcional) header Authorization para o serviço de fallback (ex.: `Bearer xxx`).
- **Recomendado no Render:** `YTDL_NO_UPDATE=1` para suprimir o aviso de update do ytdl-core.

## Fluxo do Fallback
1. Tenta `ytdl-core` normalmente.
2. Se o erro do YouTube for **429**, chama `YT_FALLBACK_BASE + encodeURIComponent(videoUrl)`.
3. O proxy responde com uma `download_url` de um arquivo de áudio (MP3/M4A/WEBM/WAV).
4. O backend baixa esse arquivo e envia para a OpenAI.

## Rota principal
`POST /quiz-from-url`

Body:
```json
{
  "url": "https://www.youtube.com/watch?v=XXXX",
  "num": 5
}
```

## Testes locais
```bash
npm install
export OPENAI_API_KEY=sk-xxx
export YT_FALLBACK_BASE=https://yt-proxy.suaempresa.com/api/mp3?url=
node index.js
curl -X POST http://localhost:10000/quiz-from-url -H "Content-Type: application/json" -d '{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ","num":3}'
```

## Observações
- Se você não tiver um serviço de fallback, suba um **ytdl-server** próprio (existem repositórios open-source e imagens Docker) ou implemente uma **Cloudflare Worker** que chame `yt-dlp` hospedado em outro lugar.
- Evite usar serviços públicos instáveis. Ter **proxy próprio** dá previsibilidade ao projeto.
