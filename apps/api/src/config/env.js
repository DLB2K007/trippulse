// Centraliza o acesso às variáveis de ambiente da API.
// Valores padrão permitem rodar o servidor sem arquivo .env.

export function loadEnv() {
  const port = Number.parseInt(process.env.PORT ?? '', 10);

  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number.isNaN(port) ? 3000 : port,
  };
}
