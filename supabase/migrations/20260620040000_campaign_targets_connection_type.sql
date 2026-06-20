-- Tipo de conexión por target (evolution | meta_whatsapp | zernio). El dispatcher
-- la usa para rutear cada envío. Faltaba (migración Lovable) → start/dispatcher fallaban.
ALTER TABLE public.campaign_targets
  ADD COLUMN IF NOT EXISTS connection_type text NOT NULL DEFAULT 'evolution';
