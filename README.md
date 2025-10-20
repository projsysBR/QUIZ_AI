# Quiz API v9.11 (Ultra Sanitize)
- Remove qualquer prefixo que o modelo invente: `1.0)`, `1)`, `A)`, `I)`, `1.`, `1-`, etc. (com múltiplas passagens)
- Reaplica sempre: Pergunta `N. ...`, alternativas `1) ...` a `5) ...`
- `answer_index` de 1 a 5
- `/health` agora inclui `version: "v9.11-ultra"` para verificação rápida
