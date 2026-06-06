ALTER TABLE public.platform_plans
  ADD COLUMN IF NOT EXISTS checkout_url_yearly text;

COMMENT ON COLUMN public.platform_plans.checkout_url IS 'Link de checkout do ciclo mensal';
COMMENT ON COLUMN public.platform_plans.checkout_url_yearly IS 'Link de checkout do ciclo anual';