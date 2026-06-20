-- BUG: las métricas de quiz/whatsapp nunca se incrementaban.
-- El CHECK de funnel_analytics.channel solo permitía 'chat'/'form'/'widget', pero el quiz
-- envía channel='quiz' (y WhatsApp 'whatsapp'). El RPC increment_funnel_leads/views hace
-- INSERT ... ON CONFLICT en funnel_analytics; al violar el CHECK, toda la función hacía
-- ROLLBACK → capture_funnels.total_leads/total_views se quedaban en 0 pese a crear el lead.

ALTER TABLE public.funnel_analytics DROP CONSTRAINT IF EXISTS funnel_analytics_channel_check;
ALTER TABLE public.funnel_analytics ADD CONSTRAINT funnel_analytics_channel_check
  CHECK (channel = ANY (ARRAY['chat','form','widget','quiz','whatsapp','chatbot','landing']));

-- Backfill de contadores ya perdidos (leads creados por funnels sin contar).
UPDATE public.capture_funnels cf SET total_leads = sub.cnt
FROM (
  SELECT metadata->>'funnel_id' AS fid, count(*)::int AS cnt
  FROM public.leads WHERE metadata->>'funnel_id' IS NOT NULL GROUP BY 1
) sub
WHERE cf.id::text = sub.fid AND cf.total_leads <> sub.cnt;
