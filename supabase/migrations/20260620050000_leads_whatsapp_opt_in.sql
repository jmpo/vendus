-- Opt-in de WhatsApp por lead. Lo usan manual-outreach, campaign-start y
-- campaign-dispatcher (guard de opt-out). Faltaba (migración Lovable): el select
-- de manual-outreach fallaba y el lead volvía null → "No phone".
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT true;
