-- Agendar dispatcher (1/min) e snapshot recorrente (a cada 15min) das Campanhas Inteligentes
DO $$
DECLARE
  v_url text := 'https://syvhrtaksjcvhrzhbltt.supabase.co/functions/v1';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5dmhydGFrc2pjdmhyemhibHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTU1NDEsImV4cCI6MjA5MzYzMTU0MX0.wnXrkMUWnN4MdBt1QB2p3BXlHTwxxsox8zLrV2sMZPw';
BEGIN
  -- Limpa eventuais agendamentos antigos
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('campaign-dispatcher','campaign-recurring-snapshot');

  PERFORM cron.schedule(
    'campaign-dispatcher',
    '* * * * *',
    format($f$ select net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb) $f$,
      v_url || '/campaign-dispatcher',
      json_build_object('Content-Type','application/json','Authorization','Bearer '||v_key)::text
    )
  );

  PERFORM cron.schedule(
    'campaign-recurring-snapshot',
    '*/15 * * * *',
    format($f$ select net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb) $f$,
      v_url || '/campaign-recurring-snapshot',
      json_build_object('Content-Type','application/json','Authorization','Bearer '||v_key)::text
    )
  );
END $$;