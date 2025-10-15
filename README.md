# yt-allinone-retry2

- Refaz `getInfo` a cada tentativa e usa `ytdl.downloadFromInfo` com `dlChunkSize` para reduzir erros 410.
- Rota única `/quiz-from-youtube` (transcrição + questões).

Deploy igual aos anteriores. Var: `OPENAI_API_KEY`.
