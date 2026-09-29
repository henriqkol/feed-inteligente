// Notificação das edições (Web Push, gratuito). A chave privada fica em app_segredos, nunca no git.
import webpush from 'web-push';
import { pool } from './db.js';
import { runIfMain } from './cli.js';
import type { FeedEntry } from './ranking.js';

const ASSUNTO = 'https://henriqkol.github.io/feed-inteligente/';

/**
 * Garante o par de chaves VAPID. Na primeira execução o job gera as chaves:
 * a privada vai para app_segredos (nunca sai do servidor) e a pública para preferencias (o app lê).
 */
export async function ensureVapid(): Promise<{ publica: string; privada: string }> {
  const { rows } = await pool.query<{ privada: string | null; publica: string | null }>(
    `select (select valor from app_segredos where chave = 'vapid_privada') as privada,
            (select valor #>> '{}' from preferencias where chave = 'vapid_publica') as publica`,
  );
  if (rows[0].privada && rows[0].publica) return { publica: rows[0].publica, privada: rows[0].privada };
  const k = webpush.generateVAPIDKeys();
  await pool.query(`insert into app_segredos (chave, valor) values ('vapid_privada', $1)`, [k.privateKey]);
  await pool.query(
    `insert into preferencias (chave, valor) values ('vapid_publica', to_jsonb($1::text))
     on conflict (chave) do update set valor = excluded.valor`,
    [k.publicKey],
  );
  console.log('✓ Chaves das notificações criadas');
  return { publica: k.publicKey, privada: k.privateKey };
}

export async function notifyEdition(feed: FeedEntry[]): Promise<{ enviadas: number; removidas: number } | null> {
  const chaves = await ensureVapid();
  const { rows: inscricoes } = await pool.query<{ endpoint: string; p256dh: string; auth: string }>(
    'select endpoint, p256dh, auth from push_inscricoes',
  );
  if (inscricoes.length === 0 || feed.length === 0) return { enviadas: 0, removidas: 0 };

  webpush.setVapidDetails(ASSUNTO, chaves.publica, chaves.privada);
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));
  const destaque = feed.find((f) => f.reason === 'relevance') ?? feed[0];
  const longa = feed.find((f) => f.reason === 'longa');
  const payload = JSON.stringify({
    title: `Edição da ${hora < 12 ? 'manhã' : 'tarde'} · ${feed.length} notícias`,
    body: destaque.item.title + (longa ? `\nLeitura longa: ${longa.item.title}` : ''),
    url: './#hoje',
  });

  let enviadas = 0, removidas = 0;
  for (const s of inscricoes) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 });
      await pool.query('update push_inscricoes set ultimo_envio = now() where endpoint = $1', [s.endpoint]);
      enviadas++;
    } catch (e: any) {
      // 404/410 = o aparelho cancelou a inscrição (app desinstalado, permissão revogada)
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await pool.query('delete from push_inscricoes where endpoint = $1', [s.endpoint]);
        removidas++;
      } else console.warn('✗ push:', e?.statusCode ?? '', e?.body ?? e?.message);
    }
  }
  return { enviadas, removidas };
}

// Teste manual: npm run notificar  (envia a edição atual)
runIfMain(import.meta.url, async () => {
  const { rows } = await pool.query(
    `select f.reason, a.id, a.title from feed f join articles a on a.id = f.article_id
      where f.day = (select max(day) from feed) order by f.position`,
  );
  const feed = rows.map((r) => ({ reason: r.reason, item: { id: Number(r.id), title: r.title } })) as unknown as FeedEntry[];
  console.log(await notifyEdition(feed));
});
