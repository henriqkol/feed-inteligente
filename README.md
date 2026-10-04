# Feed Inteligente

App (PWA) de notícias de fontes confiáveis, escolhidas para você aprender algo todo dia. Os temas são TI, tecnologia, negócios, finanças, política, geopolítica, ciência, curiosidades, natureza, projetos sociais, literatura, artes e música.

- **Edições às 6h e às 17h:** 30 notícias com limite por tema, variedade garantida e cerca de 12% de *descobertas* fora do seu padrão.
- **Aprende com você:** leitura até o fim, **Salvar** e **Aprendi algo** aumentam o peso do tema. **Menos disso** e abrir e fechar rápido diminuem. Interesses esquecidos perdem força devagar.
- **Saúde do feed:** filtra clickbait e patrocinados, junta a mesma notícia vinda de vários veículos e desliga sozinho fontes que quebram.
- **Para aprender, não só ler:**
  - Leitura longa do dia em destaque, e leitura dentro do app quando o feed traz o texto completo.
  - Comparação das coberturas de uma mesma notícia.
  - Pergunta de reflexão ao marcar "Aprendi algo" e revisão espaçada dos aprendizados (7 → 30 → 90 dias).
- **Hábito:** meta diária de leituras, sequência de dias, retrospectiva do mês (tela *Você*) e avisos no celular a cada edição (Web Push; as chaves são geradas pelo próprio job e a privada nunca sai do banco).
- **Boletim em áudio:** a cada edição, um roteiro de rádio em português que resume as notícias, lido pela voz neural (Edge TTS). Quem escreve é o Claude, pela assinatura (segredo `CLAUDE_CODE_OAUTH_TOKEN`, gerado com `claude setup-token`). Sem o token, sai um boletim simples com as manchetes e os resumos.
- **Sem custo extra:** nada usa API paga. Imagens e textos vêm dos próprios feeds.

**Instalação no Android:** abra o endereço do app no Chrome → menu ⋮ → **Instalar app**.

## Arquitetura

```
GitHub Actions (de hora em hora)                       Supabase (Postgres + pgvector)
  src/job.ts: aprender → coletar RSS → ranquear  ───►  articles, interests, feed, execucoes…
                                                             ▲            │
                                                   events, salvos       v_feed, v_salvos…
                                                             │            ▼
                                             app/ (PWA no GitHub Pages, login do Supabase)
```

| Pasta | O que é |
|---|---|
| `app/` | PWA sem build (ES modules, supabase-js via jsdelivr), no mesmo estilo do Finanças da Casa. Publicado no GitHub Pages pelo workflow `publicar-app.yml`. |
| `src/` | Motor em TypeScript/Node. `job.ts` roda tudo em sequência e registra cada execução em `execucoes`. |
| `supabase/migrations/` | Esquema do banco. Projeto `ksypzmgnrtzamslcefbu`, região São Paulo. |
| `test/` | Testes do algoritmo com dados sintéticos (`npm test`). |

### Segurança
- **App:** usa a chave pública do Supabase e login só com conta Google. Pelo RLS, só e-mails na tabela `membros` veem ou alteram dados. O app só consegue registrar eventos, salvar itens e ajustar pesos de interesses e fontes.
- **Job:** conecta com o papel `feed_job`, que tem acesso só às tabelas do app e não enxerga `membros`. A senha do papel fica apenas no segredo `DATABASE_URL` do GitHub e nunca é versionada.
- **Login com Google:** é a única forma de entrar (provedor Google em *Authentication → Sign In / Providers*; o provedor Email pode ficar desligado). No Google Cloud, a URI de redirecionamento autorizada é `https://ksypzmgnrtzamslcefbu.supabase.co/auth/v1/callback`; no Supabase, o endereço do app precisa estar em *URL Configuration → Redirect URLs*. Uma conta Google com o mesmo e-mail de uma conta existente entra na mesma conta.
- **Novo usuário:** para liberar alguém, rode `insert into membros (email) values ('...')`.

### Agendamento
O agendamento gratuito do GitHub (`schedule` no `job.yml`) atrasa e pula horários, e fica só como reserva.
Quem garante a coleta de hora em hora é o **pg_cron do Supabase**: no minuto 2 de cada hora, a função
`disparar_coleta()` chama a API do GitHub (`workflow_dispatch`), que começa em segundos. O próprio job decide se
é hora de montar edição (06h e 17h). O token do GitHub (fine-grained, só *Actions: Read and write* neste repositório)
é colado em **Mais → Atualização automática** e fica em `app_segredos`, sem leitura pela API.

## Como o algoritmo funciona

| Etapa | Arquivo | O que faz |
|---|---|---|
| Aprendizado | `src/feedback.ts`, `src/learning.ts` | Processa os eventos que o app gravou desde a última execução. Sinal positivo aproxima o vetor do tema do artigo; negativo afasta. Também ajusta afinidade e bandit. |
| Coleta | `src/ingest.ts` | Baixa os feeds em paralelo e descarta patrocinados, clickbait e textos antigos. Gera o embedding (`multilingual-e5-small`, local) e classifica o tema. Agrupa duplicatas quando o cosseno passa de 0,92 em 72h. |
| Nota | `src/ranking.ts` | `0,45·relevância + 0,20·reputação + 0,20·frescor + 0,15·profundidade`. O frescor é `e^(−h/τ)`, com τ por tema. |
| Edição | `selectFeed` | Aplica cotas por tema, MMR para diversidade e Thompson sampling para 12% de exploração, intercalando os itens. |
| Manutenção | `src/decay.ts` | Uma vez por semana: interesses não reforçados perdem 5%, o bandit esquece aos poucos e artigos com mais de 90 dias são apagados (exceto os salvos). |

Todos os pesos ficam em `src/config.ts`.

## Operação

- **Forçar uma edição agora:** aba *Actions* → *Coletar e montar o feed* → *Run workflow*.
- **Rodar localmente:** copie `.env.example` para `.env`, depois `npm install` e `npm run job`.
- **Testar sem baixar o modelo:** use `EMBED_FAKE=1` junto com um banco local.
- **Mudanças no banco:** crie uma nova migração em `supabase/migrations/` e aplique com `supabase db push` ou pelo conector do Supabase.
- **Mudanças no app:** basta um push em `main`, e o GitHub Pages atualiza sozinho. O service worker usa a rede primeiro.
- **Consultas úteis:**
  - `select * from execucoes order by inicio desc limit 10;` mostra o histórico do job.
  - `select name, active, fail_count from sources order by fail_count desc;` mostra a saúde das fontes.
  - `select slug, weight, leituras_30d from v_interesses order by weight desc;` mostra o seu perfil.

## Próximos passos possíveis
- Resumo em português e “3 pontos-chave” por IA para as notícias em inglês.
- Contraponto em política: marcar a linha editorial das fontes e buscar outra cobertura do mesmo fato.
- Revisão semanal dos itens marcados com “Aprendi algo”.
