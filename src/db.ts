import pg from 'pg';
import pgvector from 'pgvector/pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL (veja .env.example).');
}

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

// Faz colunas vector(384) voltarem como number[]
pool.on('connect', async (client) => {
  await pgvector.registerTypes(client);
});

export const toVec = (v: number[]) => pgvector.toSql(v);
