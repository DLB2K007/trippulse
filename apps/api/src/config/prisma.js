import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL não configurada. Defina a variável no ambiente ou no arquivo .env.'
  );
}

// Prisma 7 exige um driver adapter para conectar ao PostgreSQL (cliente Rust-free).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Instância única de PrismaClient reutilizada por toda a aplicação
// (cf. documentação: uma instância por processo em aplicações long-running).
export const prisma = new PrismaClient({ adapter });
