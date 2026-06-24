-- Tiempo de inactividad (min) antes de que la IA RETOME una conversación en atención
-- humana. Configurable por organización (antes era fijo en 30 en el human-handback-cron).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS handback_idle_minutes integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.organizations.handback_idle_minutes IS 'Minutos de inactividad humana antes de que la IA retome la conversación (human-handback-cron)';
