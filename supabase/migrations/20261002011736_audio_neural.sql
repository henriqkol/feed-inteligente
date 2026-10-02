-- =====================================================================
-- Narração com vozes neurais (Edge TTS), gratuita.
-- O robô gera um MP3 por notícia da edição e envia para o bucket público "audios"
-- através da função "audio" (que confere uma chave guardada só no servidor).
-- O app toca o arquivo; sem áudio, usa a voz do celular como reserva.
-- =====================================================================
alter table articles add column if not exists audio     text;  -- caminho no bucket "audios"
alter table articles add column if not exists audio_voz text;  -- voz usada (para regerar se você trocar)

-- Bucket público (notícias públicas): o app toca direto pela URL, com suporte a avançar/voltar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audios', 'audios', true, 20971520, array['audio/mpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Chave que o robô usa para enviar áudios à função (gerada aqui, nunca sai do servidor).
insert into app_segredos (chave, valor)
values ('audio_chave', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (chave) do nothing;

-- Vozes padrão (dá para trocar em Mais → Voz da narração)
insert into preferencias (chave, valor) values
  ('voz_neural_pt', '"pt-BR-FranciscaNeural"'),
  ('voz_neural_en', '"en-US-AvaMultilingualNeural"')
on conflict (chave) do nothing;

-- v_feed com o áudio (coluna nova no fim, para manter a visão compatível)
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
       exists (select 1 from events e where e.article_id = a.id and e.kind = 'less')                as menos,
       a.audio
  from feed f
  join articles a on a.id = f.article_id
  join sources  s on s.id = a.source_id
  join topics   t on t.slug = a.topic
 where f.day = (select max(day) from feed);
