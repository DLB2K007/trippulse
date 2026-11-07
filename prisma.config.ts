import "dotenv/config";
import { defineConfig } from "prisma/config";

// `process.env` direto (sem o helper `env()`) porque o dado é opcional para
// alguns comandos (ex.: `prisma generate`), evitando falha na ausência de .env.
// A validação real de conexión acontece em apps/api/src/config/prisma.js.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
