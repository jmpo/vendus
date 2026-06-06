
-- Pool de chaves de IA gerenciado pelo Super Admin
CREATE TABLE public.platform_ai_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','gemini','lovable')),
  label text NOT NULL,
  api_key_encrypted text NOT NULL,
  api_key_masked text NOT NULL,
  model_default text,
  priority int NOT NULL DEFAULT 100,
  weight int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  usage_count bigint NOT NULL DEFAULT 0,
  last_error text,
  last_verified_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_ai_keys TO authenticated;
GRANT ALL ON public.platform_ai_keys TO service_role;

ALTER TABLE public.platform_ai_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin manage platform_ai_keys"
ON public.platform_ai_keys
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_platform_ai_keys_provider_active ON public.platform_ai_keys(provider, is_active);

CREATE TRIGGER trg_platform_ai_keys_updated_at
BEFORE UPDATE ON public.platform_ai_keys
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Plano: provedor preferencial do pool e estratégia
ALTER TABLE public.platform_plans
  ADD COLUMN IF NOT EXISTS platform_ai_provider text NOT NULL DEFAULT 'lovable'
    CHECK (platform_ai_provider IN ('lovable','openai','anthropic','gemini')),
  ADD COLUMN IF NOT EXISTS platform_ai_strategy text NOT NULL DEFAULT 'random'
    CHECK (platform_ai_strategy IN ('random','round_robin'));

-- Log de uso: auditar qual chave do pool foi consumida
ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS platform_key_id uuid REFERENCES public.platform_ai_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS key_label text;

-- RPC: escolhe uma chave do pool conforme estratégia
CREATE OR REPLACE FUNCTION public.pick_platform_ai_key(
  p_provider text,
  p_strategy text DEFAULT 'random'
)
RETURNS TABLE (
  id uuid,
  provider text,
  label text,
  api_key_encrypted text,
  model_default text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_strategy = 'round_robin' THEN
    SELECT k.id INTO v_id
    FROM public.platform_ai_keys k
    WHERE k.provider = p_provider AND k.is_active = true
    ORDER BY COALESCE(k.last_used_at, 'epoch'::timestamptz) ASC, k.priority ASC
    LIMIT 1;
  ELSE
    -- random ponderado por weight
    SELECT k.id INTO v_id
    FROM public.platform_ai_keys k
    WHERE k.provider = p_provider AND k.is_active = true
    ORDER BY random() * GREATEST(k.weight,1) DESC
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.platform_ai_keys
     SET last_used_at = now(), usage_count = usage_count + 1
   WHERE platform_ai_keys.id = v_id;

  RETURN QUERY
  SELECT k.id, k.provider, k.label, k.api_key_encrypted, k.model_default
  FROM public.platform_ai_keys k
  WHERE k.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pick_platform_ai_key(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_platform_ai_key(text, text) TO service_role;
