-- Cron de reconciliación de entrega de WhatsApp (cada 5 min).
-- Reintenta envíos fallidos transitorios y alerta lo no recuperable → "que el mensaje siempre llegue".
-- La función delivery-reconciliation se despliega con --no-verify-jwt (no requiere auth).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'delivery-reconciliation';
exception when others then null;
end $$;

select cron.schedule(
  'delivery-reconciliation',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://jtdvnyqxhsrtqpamtepz.supabase.co/functions/v1/delivery-reconciliation',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
