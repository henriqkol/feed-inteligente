-- "Lida" passa a significar concluída: só com "Aprendi algo" ou "Menos disso".
-- Abrir, ler no app ou ouvir continuam registrados (meta diária e aprendizado), mas não marcam como lida.
create or replace view v_feed with (security_invoker = true) as
select f.day, f.position, f.reason, f.score, f.also_covered_by,
       a.id, a.title, a.summary, a.url, a.published_at, a.word_count, a.topic, a.image_url,
       (a.content is not null) as tem_texto,
       coalesce(a.cluster_id, a.id) as cluster_id,
       t.label as topic_label, s.name as source, s.lang,
       exists (select 1 from salvos sv where sv.article_id = a.id)                                  as salvo,
       exists (select 1 from salvos sv where sv.article_id = a.id and sv.aprendi)                   as aprendi,
       (exists (select 1 from salvos sv where sv.article_id = a.id and sv.aprendi)
        or exists (select 1 from events e where e.article_id = a.id and e.kind = 'less'))           as lido,
       exists (select 1 from events e where e.article_id = a.id and e.kind = 'less')                as menos
  from feed f
  join articles a on a.id = f.article_id
  join sources  s on s.id = a.source_id
  join topics   t on t.slug = a.topic
 where f.day = (select max(day) from feed);
