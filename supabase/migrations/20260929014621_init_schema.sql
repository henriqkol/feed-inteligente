-- news-brain: esquema Postgres + pgvector
-- Embeddings: multilingual-e5-small (384 dimensões, entende PT e EN)

-- No Supabase, extensões ficam no schema "extensions" (já está no search_path)
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- Temas de interesse. A "description" gera o protótipo semântico do tema.
create table if not exists topics (
  slug        text primary key,
  label       text not null,
  description text not null,
  tau_hours   real not null,                 -- constante de tempo do frescor: e^(-horas/tau)
  max_share   real not null default 0.30,    -- fatia máxima do feed diário
  prototype   vector(384)
);

-- Fontes: lista fechada, cada uma com nota de reputação.
create table if not exists sources (
  id            serial primary key,
  name          text not null,
  feed_url      text not null unique,
  default_topic text not null references topics(slug),
  reputation    real not null check (reputation between 0 and 1),
  longform      boolean not null default false, -- veículo de análise/texto longo
  lang          text not null default 'en',
  active        boolean not null default true,  -- desligada automaticamente após falhas seguidas
  fail_count    int not null default 0,
  last_ok_at    timestamptz
);

create table if not exists articles (
  id               bigserial primary key,
  source_id        int not null references sources(id),
  url              text not null unique,
  title            text not null,
  summary          text,
  word_count       int not null default 0,
  published_at     timestamptz not null,
  fetched_at       timestamptz not null default now(),
  topic            text not null references topics(slug),
  topic_confidence real,
  clickbait        real not null default 0,
  depth            real not null default 0,
  cluster_id       bigint,                         -- mesma notícia em fontes diferentes
  embedding        vector(384) not null
);
create index if not exists articles_embedding_idx on articles using hnsw (embedding vector_cosine_ops);
create index if not exists articles_published_idx on articles (published_at desc);
create index if not exists articles_cluster_idx   on articles (cluster_id);

-- Perfil de interesse: um vetor por tema + afinidade + parâmetros do bandit (Beta).
create table if not exists interests (
  topic              text primary key references topics(slug),
  vector             vector(384) not null,
  weight             real not null default 0.5,   -- afinidade 0..1
  alpha              real not null default 1,     -- sucessos (bandit)
  beta               real not null default 1,     -- fracassos (bandit)
  last_reinforced_at timestamptz not null default now()
);

do $$ begin
  create type event_kind as enum ('open', 'read', 'save', 'learned', 'less', 'bounce');
exception when duplicate_object then null; end $$;

create table if not exists events (
  id         bigserial primary key,
  article_id bigint not null references articles(id) on delete cascade,
  kind       event_kind not null,
  dwell_ms   int,
  created_at timestamptz not null default now()
);
create index if not exists events_article_idx on events (article_id);

-- Feed diário gerado pelo ranqueamento.
create table if not exists feed (
  day        date not null,
  position   int not null,
  article_id bigint not null references articles(id) on delete cascade,
  reason     text not null check (reason in ('relevance', 'exploration', 'quota')),
  score      real not null,
  also_covered_by text[] not null default '{}',
  primary key (day, position)
);

-- Segurança: o app acessa o banco pela conexão Postgres do servidor (que ignora RLS).
-- Com RLS ligado e sem políticas, a API pública do Supabase (chave anon) não lê nem escreve nada.
alter table topics    enable row level security;
alter table sources   enable row level security;
alter table articles  enable row level security;
alter table interests enable row level security;
alter table events    enable row level security;
alter table feed      enable row level security;
