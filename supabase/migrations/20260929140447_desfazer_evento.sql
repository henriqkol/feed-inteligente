-- "Desfazer" no app: permite apagar um evento enquanto o job ainda não o processou.
drop policy if exists membros_desfazer on events;
create policy membros_desfazer on events for delete to authenticated using (public.eh_membro() and processed_at is null);
