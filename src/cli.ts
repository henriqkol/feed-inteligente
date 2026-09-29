import { pathToFileURL } from 'node:url';
import { pool } from './db.js';

/**
 * Roda `fn` só quando o arquivo é executado diretamente (não quando importado pelo job).
 * Ao terminar, encerra o processo explicitamente: o modelo de embeddings e conexões HTTP
 * de feeds lentos podem deixar o Node vivo, e no GitHub Actions isso travava a fila de execuções.
 */
export function runIfMain(metaUrl: string, fn: () => Promise<unknown>) {
  if (!process.argv[1] || metaUrl !== pathToFileURL(process.argv[1]).href) return;
  fn()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
      process.exit(process.exitCode ?? 0);
    });
}
