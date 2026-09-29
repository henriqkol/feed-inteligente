import { pathToFileURL } from 'node:url';
import { pool } from './db.js';

/** Roda `fn` só quando o arquivo é executado diretamente (não quando importado pelo job). */
export function runIfMain(metaUrl: string, fn: () => Promise<unknown>) {
  if (!process.argv[1] || metaUrl !== pathToFileURL(process.argv[1]).href) return;
  fn()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
