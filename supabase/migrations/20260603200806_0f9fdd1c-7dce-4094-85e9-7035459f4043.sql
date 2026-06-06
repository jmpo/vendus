
-- Summary KPIs
CREATE OR REPLACE FUNCTION public.get_ai_usage_summary(
  p_start timestamptz,
  p_end timestamptz,
  p_provider text DEFAULT NULL,
  p_org_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_calls bigint,
  total_prompt_tokens bigint,
  total_completion_tokens bigint,
  total_tokens bigint,
  unique_orgs bigint,
  by_provider jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT * FROM ai_usage_logs
    WHERE created_at >= p_start AND created_at < p_end
      AND (p_provider IS NULL OR provider = p_provider)
      AND (p_org_id IS NULL OR organization_id = p_org_id)
  )
  SELECT
    COUNT(*)::bigint,
    COALESCE(SUM(prompt_tokens),0)::bigint,
    COALESCE(SUM(completion_tokens),0)::bigint,
    COALESCE(SUM(total_tokens),0)::bigint,
    COUNT(DISTINCT organization_id)::bigint,
    COALESCE((
      SELECT jsonb_object_agg(provider, j)
      FROM (
        SELECT provider, jsonb_build_object(
          'calls', COUNT(*),
          'prompt_tokens', COALESCE(SUM(prompt_tokens),0),
          'completion_tokens', COALESCE(SUM(completion_tokens),0),
          'total_tokens', COALESCE(SUM(total_tokens),0)
        ) j
        FROM base GROUP BY provider
      ) x
    ), '{}'::jsonb)
  FROM base;
END;
$$;

-- Daily timeseries by provider
CREATE OR REPLACE FUNCTION public.get_ai_usage_timeseries(
  p_start timestamptz,
  p_end timestamptz,
  p_provider text DEFAULT NULL,
  p_org_id uuid DEFAULT NULL
)
RETURNS TABLE (
  day date,
  provider text,
  calls bigint,
  total_tokens bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc('day', created_at)::date AS day,
    ai_usage_logs.provider,
    COUNT(*)::bigint,
    COALESCE(SUM(ai_usage_logs.total_tokens),0)::bigint
  FROM ai_usage_logs
  WHERE created_at >= p_start AND created_at < p_end
    AND (p_provider IS NULL OR ai_usage_logs.provider = p_provider)
    AND (p_org_id IS NULL OR ai_usage_logs.organization_id = p_org_id)
  GROUP BY 1, 2
  ORDER BY 1 ASC;
END;
$$;

-- Top orgs
CREATE OR REPLACE FUNCTION public.get_ai_usage_by_org(
  p_start timestamptz,
  p_end timestamptz,
  p_provider text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  organization_id uuid,
  org_name text,
  calls bigint,
  prompt_tokens bigint,
  completion_tokens bigint,
  total_tokens bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    l.organization_id,
    COALESCE(o.name, '— sem empresa —') AS org_name,
    COUNT(*)::bigint,
    COALESCE(SUM(l.prompt_tokens),0)::bigint,
    COALESCE(SUM(l.completion_tokens),0)::bigint,
    COALESCE(SUM(l.total_tokens),0)::bigint
  FROM ai_usage_logs l
  LEFT JOIN organizations o ON o.id = l.organization_id
  WHERE l.created_at >= p_start AND l.created_at < p_end
    AND (p_provider IS NULL OR l.provider = p_provider)
  GROUP BY l.organization_id, o.name
  ORDER BY 6 DESC
  LIMIT p_limit;
END;
$$;

-- Top models
CREATE OR REPLACE FUNCTION public.get_ai_usage_by_model(
  p_start timestamptz,
  p_end timestamptz,
  p_provider text DEFAULT NULL,
  p_org_id uuid DEFAULT NULL,
  p_limit int DEFAULT 30
)
RETURNS TABLE (
  provider text,
  model text,
  calls bigint,
  prompt_tokens bigint,
  completion_tokens bigint,
  total_tokens bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    l.provider,
    COALESCE(l.model, '—') AS model,
    COUNT(*)::bigint,
    COALESCE(SUM(l.prompt_tokens),0)::bigint,
    COALESCE(SUM(l.completion_tokens),0)::bigint,
    COALESCE(SUM(l.total_tokens),0)::bigint
  FROM ai_usage_logs l
  WHERE l.created_at >= p_start AND l.created_at < p_end
    AND (p_provider IS NULL OR l.provider = p_provider)
    AND (p_org_id IS NULL OR l.organization_id = p_org_id)
  GROUP BY l.provider, l.model
  ORDER BY 6 DESC
  LIMIT p_limit;
END;
$$;

-- Top platform keys
CREATE OR REPLACE FUNCTION public.get_ai_usage_by_key(
  p_start timestamptz,
  p_end timestamptz,
  p_provider text DEFAULT NULL,
  p_limit int DEFAULT 30
)
RETURNS TABLE (
  platform_key_id uuid,
  key_label text,
  provider text,
  calls bigint,
  total_tokens bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    l.platform_key_id,
    COALESCE(l.key_label, k.label, '— Lovable Gateway —') AS key_label,
    l.provider,
    COUNT(*)::bigint,
    COALESCE(SUM(l.total_tokens),0)::bigint
  FROM ai_usage_logs l
  LEFT JOIN platform_ai_keys k ON k.id = l.platform_key_id
  WHERE l.created_at >= p_start AND l.created_at < p_end
    AND (p_provider IS NULL OR l.provider = p_provider)
  GROUP BY l.platform_key_id, l.key_label, k.label, l.provider
  ORDER BY 5 DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_usage_summary(timestamptz, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_timeseries(timestamptz, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_by_org(timestamptz, timestamptz, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_by_model(timestamptz, timestamptz, text, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_by_key(timestamptz, timestamptz, text, int) TO authenticated;
