-- 1. Colunas em platform_plans
ALTER TABLE public.platform_plans
  ADD COLUMN IF NOT EXISTS allow_platform_ai boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS included_ai_tokens_month integer NOT NULL DEFAULT 0;

-- 2. Colunas em organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_tokens_bonus integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_tokens_used_current_period integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_tokens_period_start date NOT NULL DEFAULT date_trunc('month', current_date)::date;

-- 3. Grandfather: planos existentes mantêm comportamento atual
UPDATE public.platform_plans
   SET allow_platform_ai = true,
       included_ai_tokens_month = GREATEST(COALESCE(max_ai_tokens_month, 0), 1000000)
 WHERE allow_platform_ai = false;

-- 4. Tabela de logs de uso de IA
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability text NOT NULL,
  provider text NOT NULL,
  model text,
  prompt_tokens integer DEFAULT 0,
  completion_tokens integer DEFAULT 0,
  total_tokens integer DEFAULT 0,
  source text NOT NULL DEFAULT 'platform', -- 'platform' | 'own_key'
  edge_function text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_org_created ON public.ai_usage_logs(organization_id, created_at DESC);

GRANT SELECT ON public.ai_usage_logs TO authenticated;
GRANT ALL ON public.ai_usage_logs TO service_role;

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin can view all ai usage" ON public.ai_usage_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins view own org ai usage" ON public.ai_usage_logs
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- 5. Função consume tokens (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.check_and_consume_ai_tokens(
  p_org_id uuid,
  p_tokens integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_allow boolean;
  v_included integer;
  v_bonus integer;
  v_used integer;
  v_period_start date;
  v_current_period date := date_trunc('month', current_date)::date;
BEGIN
  SELECT plan_id, ai_tokens_bonus, ai_tokens_used_current_period, ai_tokens_period_start
    INTO v_plan_id, v_bonus, v_used, v_period_start
    FROM public.organizations
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Reset período se mudou de mês
  IF v_period_start IS DISTINCT FROM v_current_period THEN
    UPDATE public.organizations
       SET ai_tokens_used_current_period = 0,
           ai_tokens_period_start = v_current_period
     WHERE id = p_org_id;
    v_used := 0;
  END IF;

  -- Plano
  SELECT allow_platform_ai, included_ai_tokens_month
    INTO v_allow, v_included
    FROM public.platform_plans
   WHERE id = v_plan_id;

  IF v_plan_id IS NULL OR v_allow IS NULL OR v_allow = false THEN
    RETURN false;
  END IF;

  IF (v_used + p_tokens) > (COALESCE(v_included, 0) + COALESCE(v_bonus, 0)) THEN
    RETURN false;
  END IF;

  UPDATE public.organizations
     SET ai_tokens_used_current_period = ai_tokens_used_current_period + p_tokens
   WHERE id = p_org_id;

  RETURN true;
END;
$$;

-- 6. Função somente-leitura para o frontend
CREATE OR REPLACE FUNCTION public.get_org_ai_tokens_status(p_org_id uuid)
RETURNS TABLE (
  allow_platform_ai boolean,
  included integer,
  bonus integer,
  used integer,
  period_start date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_period date := date_trunc('month', current_date)::date;
BEGIN
  RETURN QUERY
  SELECT COALESCE(pp.allow_platform_ai, false),
         COALESCE(pp.included_ai_tokens_month, 0),
         COALESCE(o.ai_tokens_bonus, 0),
         CASE WHEN o.ai_tokens_period_start = v_current_period
              THEN COALESCE(o.ai_tokens_used_current_period, 0)
              ELSE 0
         END,
         COALESCE(o.ai_tokens_period_start, v_current_period)
    FROM public.organizations o
    LEFT JOIN public.platform_plans pp ON pp.id = o.plan_id
   WHERE o.id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_consume_ai_tokens(uuid, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_ai_tokens_status(uuid) TO authenticated, service_role;