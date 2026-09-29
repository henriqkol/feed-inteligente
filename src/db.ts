import pg from 'pg';
import pgvector from 'pgvector/pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL (veja .env.example).');
}

const url = process.env.DATABASE_URL;
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);

export const pool = new pg.Pool({
  connectionString: url,
  max: 3,
  // O Supabase exige TLS; o certificado do pooler não vem de uma CA pública.
  ssl: local ? undefined : { rejectUnauthorized: false },
});

export const toVec = (v: number[]) => pgvector.toSql(v);

/** Colunas vector chegam como texto "[0.1,0.2,...]": converte para number[]. */
export function fromVec(v: unknown): number[] {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string') return JSON.parse(v);
  throw new Error('Vetor inválido vindo do banco');
}
