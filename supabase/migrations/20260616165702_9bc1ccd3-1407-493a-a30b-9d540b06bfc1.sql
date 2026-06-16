
CREATE OR REPLACE FUNCTION public.search_catalog_smart(
  p_organization_id uuid,
  p_product_id uuid DEFAULT NULL::uuid,
  p_query text DEFAULT NULL::text,
  p_price_min numeric DEFAULT NULL::numeric,
  p_price_max numeric DEFAULT NULL::numeric,
  p_tags text[] DEFAULT NULL::text[],
  p_attribute_filters jsonb DEFAULT NULL::jsonb,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(
  id uuid, title text, description text, price numeric, currency text,
  url text, thumbnail_url text, images jsonb, videos jsonb, documents jsonb,
  attributes jsonb, tags text[], match_score real, match_strategy text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(LEAST(COALESCE(p_limit, 5), 20), 1);
  v_query_clean text := NULLIF(TRIM(COALESCE(p_query, '')), '');
  v_results_count integer;
BEGIN
  IF v_query_clean IS NOT NULL THEN
    RETURN QUERY
    SELECT
      pci.id, pci.title, pci.description, pci.price, pci.currency,
      pci.url, pci.thumbnail_url,
      to_jsonb(COALESCE(pci.images, ARRAY[]::text[])),
      to_jsonb(COALESCE(pci.videos, ARRAY[]::text[])),
      COALESCE(pci.documents, '[]'::jsonb),
      pci.attributes, pci.tags,
      ts_rank(pci.search_vector, websearch_to_tsquery('portuguese', v_query_clean))::real,
      'fulltext'::text
    FROM public.product_catalog_items pci
    WHERE pci.organization_id = p_organization_id
      AND pci.is_active = true
      AND (p_product_id IS NULL OR pci.product_id = p_product_id)
      AND (p_price_min IS NULL OR pci.price >= p_price_min)
      AND (p_price_max IS NULL OR pci.price <= p_price_max)
      AND (p_tags IS NULL OR pci.tags && p_tags)
      AND (p_attribute_filters IS NULL OR pci.attributes @> p_attribute_filters)
      AND pci.search_vector @@ websearch_to_tsquery('portuguese', v_query_clean)
    ORDER BY match_score DESC
    LIMIT v_limit;

    GET DIAGNOSTICS v_results_count = ROW_COUNT;
    IF v_results_count > 0 THEN RETURN; END IF;

    RETURN QUERY
    SELECT
      pci.id, pci.title, pci.description, pci.price, pci.currency,
      pci.url, pci.thumbnail_url,
      to_jsonb(COALESCE(pci.images, ARRAY[]::text[])),
      to_jsonb(COALESCE(pci.videos, ARRAY[]::text[])),
      COALESCE(pci.documents, '[]'::jsonb),
      pci.attributes, pci.tags,
      GREATEST(
        similarity(COALESCE(pci.title, ''), v_query_clean),
        similarity(COALESCE(pci.description, ''), v_query_clean) * 0.7
      )::real,
      'fuzzy'::text
    FROM public.product_catalog_items pci
    WHERE pci.organization_id = p_organization_id
      AND pci.is_active = true
      AND (p_product_id IS NULL OR pci.product_id = p_product_id)
      AND (p_price_min IS NULL OR pci.price >= p_price_min)
      AND (p_price_max IS NULL OR pci.price <= p_price_max)
      AND (p_tags IS NULL OR pci.tags && p_tags)
      AND (p_attribute_filters IS NULL OR pci.attributes @> p_attribute_filters)
      AND (
        COALESCE(pci.title, '') % v_query_clean
        OR COALESCE(pci.description, '') % v_query_clean
        OR COALESCE(pci.title, '') ILIKE '%' || v_query_clean || '%'
      )
    ORDER BY match_score DESC
    LIMIT v_limit;

    GET DIAGNOSTICS v_results_count = ROW_COUNT;
    IF v_results_count > 0 THEN RETURN; END IF;

    RETURN QUERY
    SELECT
      pci.id, pci.title, pci.description, pci.price, pci.currency,
      pci.url, pci.thumbnail_url,
      to_jsonb(COALESCE(pci.images, ARRAY[]::text[])),
      to_jsonb(COALESCE(pci.videos, ARRAY[]::text[])),
      COALESCE(pci.documents, '[]'::jsonb),
      pci.attributes, pci.tags,
      0.1::real,
      'alternatives'::text
    FROM public.product_catalog_items pci
    WHERE pci.organization_id = p_organization_id
      AND pci.is_active = true
      AND (p_product_id IS NULL OR pci.product_id = p_product_id)
      AND (p_price_min IS NULL OR pci.price >= p_price_min)
      AND (p_price_max IS NULL OR pci.price <= p_price_max)
    ORDER BY pci.created_at DESC
    LIMIT v_limit;
  ELSE
    RETURN QUERY
    SELECT
      pci.id, pci.title, pci.description, pci.price, pci.currency,
      pci.url, pci.thumbnail_url,
      to_jsonb(COALESCE(pci.images, ARRAY[]::text[])),
      to_jsonb(COALESCE(pci.videos, ARRAY[]::text[])),
      COALESCE(pci.documents, '[]'::jsonb),
      pci.attributes, pci.tags,
      1.0::real,
      'filter_only'::text
    FROM public.product_catalog_items pci
    WHERE pci.organization_id = p_organization_id
      AND pci.is_active = true
      AND (p_product_id IS NULL OR pci.product_id = p_product_id)
      AND (p_price_min IS NULL OR pci.price >= p_price_min)
      AND (p_price_max IS NULL OR pci.price <= p_price_max)
      AND (p_tags IS NULL OR pci.tags && p_tags)
      AND (p_attribute_filters IS NULL OR pci.attributes @> p_attribute_filters)
    ORDER BY pci.created_at DESC
    LIMIT v_limit;
  END IF;
END;
$function$;
