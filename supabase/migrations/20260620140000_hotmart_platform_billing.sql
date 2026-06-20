-- Billing de PLATAFORMA vía Hotmart (vender el CRM por Hotmart).
-- Mapeo plan↔producto Hotmart + vínculo de la org con su email/suscripción Hotmart.
-- El webhook hotmart-webhook?scope=platform crea/activa la org según el plan mapeado.

ALTER TABLE public.platform_plans
  ADD COLUMN IF NOT EXISTS hotmart_product_id text,
  ADD COLUMN IF NOT EXISTS checkout_url_hotmart text;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hotmart_customer_email text,
  ADD COLUMN IF NOT EXISTS hotmart_subscription_id text;

CREATE INDEX IF NOT EXISTS idx_orgs_hotmart_email ON public.organizations(hotmart_customer_email) WHERE hotmart_customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plans_hotmart_product ON public.platform_plans(hotmart_product_id) WHERE hotmart_product_id IS NOT NULL;

COMMENT ON COLUMN public.platform_plans.hotmart_product_id IS 'ID del producto Hotmart que mapea a este plan de plataforma';
COMMENT ON COLUMN public.organizations.hotmart_customer_email IS 'Email del comprador en Hotmart (para vincular la org al pagar)';
