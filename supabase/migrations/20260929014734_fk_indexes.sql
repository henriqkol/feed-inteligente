-- Índices para chaves estrangeiras (recomendação do advisor do Supabase).
-- feed.article_id é usado no ranqueamento para não repetir itens de dias anteriores.
create index if not exists articles_source_idx      on articles (source_id);
create index if not exists articles_topic_idx       on articles (topic, published_at desc);
create index if not exists feed_article_idx         on feed (article_id);
create index if not exists sources_default_topic_idx on sources (default_topic);
