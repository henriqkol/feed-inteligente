-- As chaves das notificações são geradas pelo próprio job na primeira execução:
-- a privada fica em app_segredos (só o job lê) e a pública em preferencias (o app lê).
drop policy if exists job_criar on app_segredos;
create policy job_criar on app_segredos for insert to feed_job with check (chave = 'vapid_privada');
drop policy if exists job_tudo on preferencias;
create policy job_tudo on preferencias for all to feed_job using (true) with check (true);
