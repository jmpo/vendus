-- 1. platform_plans.cakto_offer_slug
ALTER TABLE public.platform_plans
  ADD COLUMN IF NOT EXISTS cakto_offer_slug text;

CREATE UNIQUE INDEX IF NOT EXISTS platform_plans_cakto_offer_slug_uniq
  ON public.platform_plans (cakto_offer_slug)
  WHERE cakto_offer_slug IS NOT NULL;

-- 2. cakto_orders.cakto_offer_slug + backfill
ALTER TABLE public.cakto_orders
  ADD COLUMN IF NOT EXISTS cakto_offer_slug text;

-- Backfill: extrai o último segmento de raw_payload->>'checkout_url'
UPDATE public.cakto_orders
SET cakto_offer_slug = regexp_replace(
  raw_payload->>'checkout_url',
  '^.*/([^/?#]+).*$',
  '\1'
)
WHERE cakto_offer_slug IS NULL
  AND raw_payload ? 'checkout_url'
  AND length(raw_payload->>'checkout_url') > 0;

CREATE INDEX IF NOT EXISTS cakto_orders_offer_slug_idx
  ON public.cakto_orders (cakto_offer_slug)
  WHERE cakto_offer_slug IS NOT NULL;

-- 3. Consolida índices duplicados em cakto_orders (mantém *_scope_org_cakto_id_key)
DROP INDEX IF EXISTS public.cakto_orders_unique_per_scope;

-- 4. organizations.plan_status + plan_activated_at
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_status text,
  ADD COLUMN IF NOT EXISTS plan_activated_at timestamptz;

-- 5. billing_history.metadata + índice por cakto_id
ALTER TABLE public.billing_history
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS billing_history_metadata_cakto_id_idx
  ON public.billing_history ((metadata->>'cakto_id'))
  WHERE metadata ? 'cakto_id';

-- 6. RPC get_auth_user_id_by_email (SECURITY DEFINER, restrita ao service_role)
CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_auth_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_auth_user_id_by_email(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) TO service_role;