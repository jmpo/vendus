-- Reglas de conversión por NOMBRE de etapa (no por stage_id de un producto puntual).
-- Modelo "etapas estándar compartidas": todas las líneas/productos usan las mismas etapas,
-- así una regla "Calificación → InitiateCheckout" aplica a TODAS las líneas sin duplicar.

ALTER TABLE public.conversion_event_rules ADD COLUMN IF NOT EXISTS stage_name text;

-- Backfill: reglas existentes por stage_id → nombre; product_id null = aplica a todos.
UPDATE public.conversion_event_rules r SET stage_name = ps.name
FROM public.pipeline_stages ps
WHERE r.trigger_type = 'stage' AND r.stage_id = ps.id AND r.stage_name IS NULL;
UPDATE public.conversion_event_rules SET product_id = NULL WHERE trigger_type = 'stage';

ALTER TABLE public.conversion_event_rules DROP CONSTRAINT IF EXISTS chk_rule_target;
ALTER TABLE public.conversion_event_rules ADD CONSTRAINT chk_rule_target CHECK (
  (trigger_type = 'stage' AND stage_name IS NOT NULL) OR
  (trigger_type = 'tag'   AND tag_id     IS NOT NULL)
);

-- Trigger: matchea por NOMBRE de la etapa a la que entra el lead (en cualquier línea).
CREATE OR REPLACE FUNCTION public.fn_lead_stage_conversion_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public','vault','extensions' AS $fn$
DECLARE r public.conversion_event_rules; _stage_name text;
BEGIN
  IF NEW.current_stage_id IS NULL OR NEW.current_stage_id IS NOT DISTINCT FROM OLD.current_stage_id THEN
    RETURN NEW;
  END IF;
  SELECT name INTO _stage_name FROM public.pipeline_stages WHERE id = NEW.current_stage_id;
  IF _stage_name IS NULL THEN RETURN NEW; END IF;
  FOR r IN
    SELECT * FROM public.conversion_event_rules
    WHERE is_active AND trigger_type = 'stage'
      AND organization_id = NEW.organization_id
      AND stage_name = _stage_name
      AND (product_id IS NULL OR product_id = NEW.product_id)
  LOOP
    PERFORM public.fire_conversion_rule(r, NEW.id, NEW.deal_value);
  END LOOP;
  RETURN NEW;
END $fn$;
