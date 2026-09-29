# news-brain — feed pessoal de notícias

Motor de coleta e ranqueamento para um app de notícias que prioriza **fontes reputadas, profundidade e variedade**, aprendendo com o seu comportamento sem cair numa bolha.

```
RSS (34 fontes) ─► limpeza + filtros ─► embedding ─► tema + deduplicação ─► Postgres/pgvector
                                                                                 │
     você lê/salva/rejeita ─► feedback (EMA + bandit) ─► perfil de interesses ◄──┤
                                                                                 ▼
                          ranqueamento: nota ─► cotas ─► MMR ─► exploração ─► feed do dia
```

## Como o algoritmo funciona

| Etapa | Arquivo | O que faz |
|---|---|---|
| Coleta | `src/ingest.ts` | Lê RSS; descarta patrocinados, clickbait e textos antigos. Gera o embedding, escolhe o tema e agrupa a mesma notícia de fontes diferentes (cosseno > 0,92 em 72h). Fontes com 5 falhas seguidas são desativadas. |
| Nota | `src/ranking.ts` | `0,45·relevância + 0,20·reputação + 0,20·frescor + 0,15·profundidade`. O frescor é `e^(−h/τ)`, com τ por tema. |
| Deduplicação | `collapseClusters` | Mantém a fonte mais reputada e lista as demais em "outras coberturas". |
| Cotas | `selectFeed` | Nenhum tema passa do seu `max_share`. Temas sem aparição na semana ganham vaga garantida (até 3/dia). |
| Diversidade | `selectFeed` (MMR) | Escolhe o próximo item por `0,7·nota − 0,3·semelhança com o que já entrou`. |
| Exploração | `selectFeed` (Thompson) | 12% do feed vem de temas pouco presentes hoje, escolhendo por qualidade e ignorando relevância. Esses itens ficam intercalados. |
| Aprendizado | `src/learning.ts`, `src/feedback.ts` | Leitura longa, salvar e "aprendi algo" aproximam o vetor do tema. Rejeição (< 10s) e "menos disso" afastam. |
| Saúde | `src/decay.ts` | Toda semana, interesses não reforçados perdem 5% (mínimo 0,1). O bandit esquece aos poucos e artigos com mais de 90 dias são apagados. |

Todos os pesos ficam em `src/config.ts`.

## Rodando

Requisitos: Node 20+ e Postgres com a extensão `vector` (o Supabase já tem).

O banco já está criado no Supabase: projeto **feed-inteligente** (`ksypzmgnrtzamslcefbu`, região São Paulo), com as migrations de `supabase/migrations/` aplicadas.

```bash
cp .env.example .env            # cole a connection string (veja abaixo)
npm install
npm run setup                   # protótipos dos temas + perfil inicial (baixa o modelo ~120 MB)
npm run ingest                  # primeira coleta
npm run rank                    # monta e imprime o feed de hoje
npm test                        # testa o algoritmo com dados sintéticos
```

**Connection string:** no painel do Supabase, clique em **Connect** e copie a do **Session pooler** (porta 5432). A conexão "Direct" usa só IPv6 e costuma falhar em redes domésticas e no GitHub Actions.

**Novas mudanças no banco:** crie um arquivo em `supabase/migrations/` e rode `supabase link --project-ref ksypzmgnrtzamslcefbu` uma vez, depois `supabase db push`.

**Segurança:** todas as tabelas têm RLS ligado e nenhuma política. Isso é intencional: o app acessa pelo servidor com a connection string, e a API pública (chave anon) fica sem acesso a nada.

## Agendamento

| Job | Frequência | Cron |
|---|---|---|
| `npm run ingest && npm run rank` | a cada hora | `5 * * * *` |
| `npm run decay` | semanal | `0 4 * * 1` |

GitHub Actions com `schedule` resolve de graça. O modelo de embeddings roda em CPU, então não precisa de chave de API.

## Integrando ao app (Next.js)

```ts
// app/api/feed/route.ts
import { pool } from '@/lib/news-brain/db';
export async function GET() {
  const { rows } = await pool.query(`
    select f.position, f.reason, f.also_covered_by, a.id, a.title, a.summary, a.url, a.topic, s.name as source
      from feed f join articles a on a.id = f.article_id join sources s on s.id = a.source_id
     where f.day = current_date order by f.position`);
  return Response.json(rows);
}

// app/api/events/route.ts
import { recordEvent } from '@/lib/news-brain/feedback';
export async function POST(req: Request) {
  const { articleId, kind, dwellMs } = await req.json(); // kind: open | read | save | learned | less
  return Response.json(await recordEvent(articleId, kind, dwellMs));
}
```

No front, meça o tempo de leitura com `visibilitychange`/`pagehide` e envie `read` com `dwellMs`. Coloque botões para **Salvar**, **Aprendi algo** e **Menos disso**.

## Calibração (depois de ~1 semana de uso)

- **`SIM_FLOOR` / `SIM_CEIL`**: o e5 comprime similaridades. Olhe a distribuição de `dot(artigo, interesse)` nos seus dados e ajuste para que "sem relação" fique perto de 0 e "exatamente meu assunto" perto de 1.
- **`DEDUP_SIM`**: se notícias iguais escapam, baixe para 0,90. Se matérias diferentes estão sendo fundidas, suba para 0,94.
- **`reputation`** em `sources`: é a sua nota editorial, então ajuste livremente.
- **Feeds**: os endereços do seed são os públicos conhecidos. Veja em `select name, active, fail_count from sources` quais falharam e troque a URL.

## Próximos passos sugeridos

- **Resumo e "o que aprender"**: gerar por LLM 3 pontos-chave e uma pergunta de reflexão para itens salvos.
- **Contraponto em política**: marcar a linha editorial de cada fonte e, quando um cluster tiver só um lado, buscar outra cobertura.
- **Multiusuário**: adicionar `user_id` em `interests`, `events` e `feed`.
