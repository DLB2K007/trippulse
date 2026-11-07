import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = buildApp();

app.listen({ host: env.host, port: env.port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
