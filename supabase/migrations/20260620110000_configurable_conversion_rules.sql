-- Reglas CONFIGURABLES de eventos de conversión (Meta/Zernio CAPI).
-- Cada cliente arma su pipeline distinto → puede mapear: "cuando un lead entra a la
-- etapa X" o "cuando se le pone la etiqueta Y" → disparar el evento Z (LeadSubmitted,
-- Purchase, etc.). El disparo va a track-conversion (resuelve Zernio/Meta + atribución).

CREATE TABLE IF NOT EXISTS public.conversion_event_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE, -- null = todos los productos
  trigger_type text NOT NULL CHECK (trigger_type IN ('stage','tag')),
  stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  tag_id uuid REFERENCES public.lead_tags(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (event_name IN ('LeadSubmitted','Purchase','AddToCart','InitiateCheckout','ViewContent')),
  value_source text NOT NULL DEFAULT 'none' CHECK (value_source IN ('none','deal_value','fixed')),
  fixed_value numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- coherencia: stage rule exige stage_id; tag rule exige tag_id
  CONSTRAINT chk_rule_target CHECK (
    (trigger_type = 'stage' AND stage_id IS NOT NULL) OR
    (trigger_type = 'tag'   AND tag_id   IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cer_org ON public.conversion_event_rules(organization_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cer_stage ON public.conversion_event_rules(stage_id) WHERE is_active AND trigger_type = 'stage';
CREATE INDEX IF NOT EXISTS idx_cer_tag ON public.conversion_event_rules(tag_id) WHERE is_active AND trigger_type = 'tag';

ALTER TABLE public.conversion_event_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members manage conversion rules" ON public.conversion_event_rules;
CREATE POLICY "org members manage conversion rules" ON public.conversion_event_rules
  FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- ── Helper: dispara una regla vía track-conversion (pg_net) ───────────────────
CREATE OR REPLACE FUNCTION public.fire_conversion_rule(
  _rule public.conversion_event_rules, _lead_id uuid, _deal_value numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public','vault','extensions' AS $fn$
DECLARE
  k text; val numeric; eid text;
BEGIN
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'conversion_service_key' LIMIT 1;
  IF k IS NULL THEN RETURN; END IF;

  val := CASE _rule.value_source
    WHEN 'deal_value' THEN _deal_value
    WHEN 'fixed' THEN _rule.fixed_value
    ELSE NULL END;
  -- event_id determinístico → Meta dedup (1 conversión por lead+regla)
  eid := _rule.event_name || '-rule-' || _rule.id::text || '-lead-' || _lead_id::text;

  PERFORM net.http_post(
    url := 'https://jtdvnyqxhsrtqpamtepz.supabase.co/functions/v1/track-conversion',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || k),
    body := jsonb_build_object('lead_id', _lead_id, 'event_name', _rule.event_name, 'event_id', eid, 'value', val, 'currency', 'USD')
  );
END $fn$;

-- ── Trigger: lead cambia de ETAPA ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_stage_conversion_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public','vault','extensions' AS $fn$
DECLARE r public.conversion_event_rules;
BEGIN
  IF NEW.current_stage_id IS NULL OR NEW.current_stage_id IS NOT DISTINCT FROM OLD.current_stage_id THEN
    RETURN NEW;
  END IF;
  FOR r IN
    SELECT * FROM public.conversion_event_rules
    WHERE is_active AND trigger_type = 'stage'
      AND organization_id = NEW.organization_id
      AND stage_id = NEW.current_stage_id
      AND (product_id IS NULL OR product_id = NEW.product_id)
  LOOP
    PERFORM public.fire_conversion_rule(r, NEW.id, NEW.deal_value);
  END LOOP;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_lead_stage_conversion_rules ON public.leads;
CREATE TRIGGER trg_lead_stage_conversion_rules
  AFTER UPDATE OF current_stage_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_stage_conversion_rules();

-- ── Trigger: se asigna una ETIQUETA al lead ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_tag_conversion_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public','vault','extensions' AS $fn$
DECLARE r public.conversion_event_rules; l public.leads;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = NEW.lead_id;
  IF l.id IS NULL THEN RETURN NEW; END IF;
  FOR r IN
    SELECT * FROM public.conversion_event_rules
    WHERE is_active AND trigger_type = 'tag'
      AND organization_id = l.organization_id
      AND tag_id = NEW.tag_id
      AND (product_id IS NULL OR product_id = l.product_id)
  LOOP
    PERFORM public.fire_conversion_rule(r, l.id, l.deal_value);
  END LOOP;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_lead_tag_conversion_rules ON public.lead_tag_assignments;
CREATE TRIGGER trg_lead_tag_conversion_rules
  AFTER INSERT ON public.lead_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_tag_conversion_rules();
