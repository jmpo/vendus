-- Conversion tracking (Meta CAPI) — dispara LeadSubmitted/Purchase a Meta desde el ciclo de deals.
-- Funciona para Zernio (zernio-conversion) y Meta-nativa (meta-conversion) vía track-conversion.

-- Dataset ID para la conexión Meta nativa (Events Manager / CAPI).
ALTER TABLE public.whatsapp_meta_connections
  ADD COLUMN IF NOT EXISTS conversions_dataset_id text;

-- NOTA: el secret en vault 'conversion_service_key' (service role key) se crea una vez
-- vía función edge (necesita el valor de la key desde el entorno), no en esta migración.
-- SELECT vault.create_secret('<SERVICE_ROLE_KEY>', 'conversion_service_key');

-- Trigger: al crear un deal → LeadSubmitted; al pasar status a 'won' → Purchase.
-- Llama a track-conversion (edge) vía pg_net; éste resuelve la conexión (Zernio/Meta) y envía el evento.
CREATE OR REPLACE FUNCTION public.fn_deal_conversion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public','vault','extensions' AS $fn$
DECLARE
  k text; ev text; eid text; val numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    ev := 'LeadSubmitted'; eid := 'lead-' || NEW.id::text; val := NULL;
  ELSIF TG_OP = 'UPDATE' AND lower(coalesce(NEW.status,'')) = 'won' AND lower(coalesce(OLD.status,'')) <> 'won' THEN
    ev := 'Purchase'; eid := 'purchase-' || NEW.id::text; val := NEW.deal_value;
  ELSE
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'conversion_service_key' LIMIT 1;
  IF k IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := 'https://jtdvnyqxhsrtqpamtepz.supabase.co/functions/v1/track-conversion',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || k),
    body := jsonb_build_object('lead_id', NEW.lead_id, 'event_name', ev, 'event_id', eid, 'value', val, 'currency', 'USD')
  );
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_deal_conversion_ins ON public.deals;
CREATE TRIGGER trg_deal_conversion_ins AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fn_deal_conversion();
DROP TRIGGER IF EXISTS trg_deal_conversion_upd ON public.deals;
CREATE TRIGGER trg_deal_conversion_upd AFTER UPDATE OF status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fn_deal_conversion();
