# Quiz API v9.5 (Uint8Array order fix)
- Converte Buffer -> Uint8Array **antes** de checar instanceof
- Garante que pdfjs não receba Buffer (mesmo sendo subclass de Uint8Array)
