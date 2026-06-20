-- Plantilla de REENGANCHE para follow-up fuera de la ventana de 24h (WhatsApp oficial:
-- Meta/Zernio). Dentro de 24h o en Evolution se manda texto libre (IA); fuera de 24h en
-- API oficial WhatsApp SOLO permite plantillas aprobadas (HSM). Estas columnas guardan
-- qué plantilla aprobada usar para reenganchar. Si están vacías y el lead cae fuera de
-- 24h, el follow-up se marca 'failed' con motivo claro (no se reintenta en loop).
ALTER TABLE public.product_agents
  ADD COLUMN IF NOT EXISTS followup_template_name text,
  ADD COLUMN IF NOT EXISTS followup_template_language text DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS followup_template_params jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.product_agents.followup_template_name IS 'Nombre de la plantilla aprobada (Zernio/Meta) para reenganche fuera de 24h';
COMMENT ON COLUMN public.product_agents.followup_template_language IS 'Idioma de la plantilla (ej. es, es_AR, pt_BR)';
COMMENT ON COLUMN public.product_agents.followup_template_params IS 'Parámetros posicionales de la plantilla ({{1}},{{2}}...) como array JSON';
