-- Config de plantilla HSM (Meta) y Zernio para campañas. El wizard guarda acá
-- la plantilla elegida + el mapeo de variables ({{n}} → campo del lead).
-- Faltaba en este proyecto (migrado de Lovable) → el guardado/inicio fallaba.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS meta_template_config jsonb;
