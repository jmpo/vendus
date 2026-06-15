CREATE OR REPLACE FUNCTION public.create_product_tag_package(p_organization_id uuid, p_product_id uuid, p_product_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_specs jsonb := jsonb_build_array(
    jsonb_build_object('event','pix_gerado',          'name','PIX Generado',          'color','#EAB308', 'lifecycle', true),
    jsonb_build_object('event','boleto_gerado',       'name','Boleto Generado',       'color','#3B82F6', 'lifecycle', true),
    jsonb_build_object('event','pix_gerado',          'name','Esperando Pago',        'color','#F97316', 'lifecycle', true, 'also_event','boleto_gerado'),
    jsonb_build_object('event','checkout_abandonado', 'name','Checkout Abandonado',   'color','#6B7280', 'lifecycle', true),
    jsonb_build_object('event','compra_aprovada',     'name','Cliente',               'color','#22C55E', 'lifecycle', false),
    jsonb_build_object('event','reembolso',           'name','Reembolso',             'color','#EF4444', 'lifecycle', false)
  );
  v_spec jsonb;
  v_tag_id uuid;
  v_full_name text;
  v_created jsonb := '[]'::jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_product_id IS NULL OR p_product_label IS NULL THEN
    RAISE EXCEPTION 'organization_id, product_id y product_label son obligatorios';
  END IF;

  FOR v_spec IN SELECT * FROM jsonb_array_elements(v_specs)
  LOOP
    v_full_name := (v_spec->>'name') || ' · ' || p_product_label;

    SELECT id INTO v_tag_id
    FROM lead_tags
    WHERE organization_id = p_organization_id AND name = v_full_name
    LIMIT 1;

    IF v_tag_id IS NULL THEN
      INSERT INTO lead_tags (organization_id, name, color, is_automatic, is_lifecycle_status)
      VALUES (p_organization_id, v_full_name, v_spec->>'color', true, (v_spec->>'lifecycle')::boolean)
      RETURNING id INTO v_tag_id;
    ELSE
      UPDATE lead_tags
      SET is_lifecycle_status = (v_spec->>'lifecycle')::boolean
      WHERE id = v_tag_id;
    END IF;

    INSERT INTO tag_automations (organization_id, product_id, event_type, tag_id_to_add, is_active)
    SELECT p_organization_id, p_product_id, v_spec->>'event', v_tag_id, true
    WHERE NOT EXISTS (
      SELECT 1 FROM tag_automations
      WHERE organization_id = p_organization_id
        AND product_id = p_product_id
        AND event_type = v_spec->>'event'
        AND tag_id_to_add = v_tag_id
    );

    IF v_spec ? 'also_event' THEN
      INSERT INTO tag_automations (organization_id, product_id, event_type, tag_id_to_add, is_active)
      SELECT p_organization_id, p_product_id, v_spec->>'also_event', v_tag_id, true
      WHERE NOT EXISTS (
        SELECT 1 FROM tag_automations
        WHERE organization_id = p_organization_id
          AND product_id = p_product_id
          AND event_type = v_spec->>'also_event'
          AND tag_id_to_add = v_tag_id
      );
    END IF;

    v_created := v_created || jsonb_build_object('tag_id', v_tag_id, 'name', v_full_name);
  END LOOP;

  RETURN jsonb_build_object('created', v_created);
END;
$function$;