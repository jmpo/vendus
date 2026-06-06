-- 1. Add denormalized last-message columns
ALTER TABLE public.webchat_conversations
  ADD COLUMN IF NOT EXISTS last_message_content text,
  ADD COLUMN IF NOT EXISTS last_message_metadata jsonb,
  ADD COLUMN IF NOT EXISTS last_message_sender_type text,
  ADD COLUMN IF NOT EXISTS last_message_created_at timestamptz;

-- 2. Composite index to accelerate any remaining message lookups
CREATE INDEX IF NOT EXISTS idx_webchat_messages_conv_created_desc
  ON public.webchat_messages (conversation_id, created_at DESC)
  WHERE COALESCE(is_deleted, false) = false;

-- 3. Trigger function: keep denormalized last message in sync
CREATE OR REPLACE FUNCTION public.sync_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_conv_id uuid;
  v_last RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_conv_id := OLD.conversation_id;
  ELSE
    v_conv_id := NEW.conversation_id;
  END IF;

  IF v_conv_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND COALESCE(NEW.is_deleted, false) = false
     AND NEW.content IS NOT NULL THEN
    UPDATE public.webchat_conversations c
       SET last_message_content      = NEW.content,
           last_message_metadata     = NEW.metadata,
           last_message_sender_type  = NEW.sender_type,
           last_message_created_at   = NEW.created_at
     WHERE c.id = v_conv_id
       AND (c.last_message_created_at IS NULL OR NEW.created_at >= c.last_message_created_at);
    RETURN NEW;
  END IF;

  SELECT m.content, m.metadata, m.sender_type, m.created_at
    INTO v_last
    FROM public.webchat_messages m
    WHERE m.conversation_id = v_conv_id
      AND COALESCE(m.is_deleted, false) = false
    ORDER BY m.created_at DESC
    LIMIT 1;

  UPDATE public.webchat_conversations c
     SET last_message_content      = v_last.content,
         last_message_metadata     = v_last.metadata,
         last_message_sender_type  = v_last.sender_type,
         last_message_created_at   = v_last.created_at
   WHERE c.id = v_conv_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conversation_last_message ON public.webchat_messages;
CREATE TRIGGER trg_sync_conversation_last_message
AFTER INSERT OR UPDATE OR DELETE ON public.webchat_messages
FOR EACH ROW
EXECUTE FUNCTION public.sync_conversation_last_message();

-- 4. Backfill row-by-row tolerating concurrent unique-constraint conflicts
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (m.conversation_id)
           m.conversation_id, m.content, m.metadata, m.sender_type, m.created_at
      FROM public.webchat_messages m
      WHERE COALESCE(m.is_deleted, false) = false
      ORDER BY m.conversation_id, m.created_at DESC
  LOOP
    BEGIN
      UPDATE public.webchat_conversations c
         SET last_message_content      = r.content,
             last_message_metadata     = r.metadata,
             last_message_sender_type  = r.sender_type,
             last_message_created_at   = r.created_at
       WHERE c.id = r.conversation_id
         AND c.last_message_created_at IS DISTINCT FROM r.created_at;
    EXCEPTION
      WHEN unique_violation THEN
        -- Skip rows whose update would collide with the partial open-phone unique index.
        NULL;
    END;
  END LOOP;
END $$;

-- 5. Simplify inbox_list_conversations to read denormalized columns (no LATERAL)
CREATE OR REPLACE FUNCTION public.inbox_list_conversations(
  p_user_id uuid,
  p_tab text DEFAULT 'attending'::text,
  p_product_ids uuid[] DEFAULT NULL::uuid[],
  p_include_no_product boolean DEFAULT false,
  p_sector_ids uuid[] DEFAULT NULL::uuid[],
  p_include_no_sector boolean DEFAULT false,
  p_assigned_user_ids uuid[] DEFAULT NULL::uuid[],
  p_include_unassigned boolean DEFAULT false,
  p_tag_ids uuid[] DEFAULT NULL::uuid[],
  p_channel text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_cursor_last_message_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid, organization_id uuid, widget_id uuid, visitor_id text, lead_id uuid, product_id uuid,
  effective_product_id uuid, effective_product_name text,
  assigned_user_id uuid, assigned_user_name text, assigned_user_avatar text,
  current_agent_id uuid, current_agent_name text, current_agent_avatar text,
  sector_id uuid, sector_name text, sector_color text,
  evolution_instance_id uuid, status text, channel text, needs_human boolean,
  last_message_at timestamp with time zone, unread_count_agents integer,
  created_at timestamp with time zone, updated_at timestamp with time zone, closed_at timestamp with time zone,
  visitor_name text, visitor_email text, visitor_phone text, visitor_avatar_url text, visitor_whatsapp text,
  accepted_at timestamp with time zone, accepted_by uuid,
  widget_name text, widget_primary_color text, widget_product_id uuid,
  lead_name text, lead_email text, lead_phone text, lead_product_id uuid,
  last_message_content text, last_message_metadata jsonb, last_message_sender_type text, last_message_created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_is_super_admin boolean;
  v_is_admin boolean;
  v_perm_queue boolean := false;
  v_perm_other_users boolean := false;
  v_perm_other_queues boolean := false;
  v_perm_unassigned_sector boolean := false;
  v_user_sectors uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  SELECT pr.organization_id INTO v_org_id
    FROM public.profiles pr WHERE pr.id = p_user_id;

  v_is_super_admin := EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role = 'super_admin'::app_role
  );
  v_is_admin := v_is_super_admin OR EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role = 'admin'::app_role
  );

  IF v_org_id IS NULL AND NOT v_is_super_admin THEN
    RAISE EXCEPTION 'User has no organization';
  END IF;

  IF NOT v_is_admin THEN
    SELECT
      COALESCE(up.view_queue_conversations, false),
      COALESCE(up.view_other_users_conversations, false),
      COALESCE(up.view_other_queues_conversations, false),
      COALESCE(up.view_unassigned_sector_tickets, false)
    INTO v_perm_queue, v_perm_other_users, v_perm_other_queues, v_perm_unassigned_sector
    FROM public.user_permissions up
    WHERE up.user_id = p_user_id
    LIMIT 1;

    SELECT COALESCE(array_agg(sm.sector_id), ARRAY[]::uuid[]) INTO v_user_sectors
    FROM public.sector_members sm WHERE sm.user_id = p_user_id;
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.organization_id, c.widget_id, c.visitor_id::text, c.lead_id, c.product_id,
    COALESCE(c.product_id, l.product_id, w.product_id) AS effective_product_id,
    prd.name::text AS effective_product_name,
    c.assigned_user_id, pa.full_name::text AS assigned_user_name, pa.avatar_url::text AS assigned_user_avatar,
    c.current_agent_id, ag.name::text AS current_agent_name, ag.avatar_url::text AS current_agent_avatar,
    c.sector_id, sec.name::text AS sector_name, sec.color::text AS sector_color,
    c.evolution_instance_id, c.status::text, c.channel::text, c.needs_human,
    c.last_message_at, c.unread_count_agents,
    c.created_at, c.updated_at, c.closed_at,
    c.visitor_name::text, c.visitor_email::text, c.visitor_phone::text,
    c.visitor_avatar_url::text, c.visitor_whatsapp::text,
    c.accepted_at, c.accepted_by,
    w.name::text AS widget_name, w.primary_color::text AS widget_primary_color, w.product_id AS widget_product_id,
    l.name::text AS lead_name, l.email::text AS lead_email, l.phone::text AS lead_phone, l.product_id AS lead_product_id,
    c.last_message_content::text, c.last_message_metadata, c.last_message_sender_type::text, c.last_message_created_at
  FROM public.webchat_conversations c
  LEFT JOIN public.leads l            ON l.id = c.lead_id
  LEFT JOIN public.webchat_widgets w  ON w.id = c.widget_id
  LEFT JOIN public.profiles pa        ON pa.id = c.assigned_user_id
  LEFT JOIN public.product_agents ag  ON ag.id = c.current_agent_id
  LEFT JOIN public.sectors sec        ON sec.id = c.sector_id
  LEFT JOIN public.products prd       ON prd.id = COALESCE(c.product_id, l.product_id, w.product_id)
  WHERE
    (v_org_id IS NULL OR c.organization_id = v_org_id)
    AND (
      p_tab = 'all'
      OR (p_tab = 'attending' AND c.status = 'human_active')
      OR (p_tab = 'waiting'   AND c.status IN ('waiting_human','bot_active'))
      OR (p_tab = 'resolved'  AND c.status = 'closed')
    )
    AND (p_channel IS NULL OR c.channel = p_channel)
    AND (p_cursor_last_message_at IS NULL OR c.last_message_at < p_cursor_last_message_at)
    AND (
      v_is_admin
      OR c.assigned_user_id = p_user_id
      OR (c.sector_id IS NULL AND v_perm_unassigned_sector)
      OR (c.sector_id = ANY(v_user_sectors) AND c.assigned_user_id IS NULL AND v_perm_queue)
      OR (c.sector_id = ANY(v_user_sectors) AND c.assigned_user_id IS NOT NULL AND v_perm_other_users)
      OR (c.sector_id IS NOT NULL AND NOT (c.sector_id = ANY(v_user_sectors)) AND v_perm_other_queues)
    )
    AND (
      (p_product_ids IS NULL AND NOT p_include_no_product)
      OR (p_include_no_product AND COALESCE(c.product_id, l.product_id, w.product_id) IS NULL)
      OR (p_product_ids IS NOT NULL AND COALESCE(c.product_id, l.product_id, w.product_id) = ANY(p_product_ids))
    )
    AND (
      (p_sector_ids IS NULL AND NOT p_include_no_sector)
      OR (p_include_no_sector AND c.sector_id IS NULL)
      OR (p_sector_ids IS NOT NULL AND c.sector_id = ANY(p_sector_ids))
    )
    AND (
      (p_assigned_user_ids IS NULL AND NOT p_include_unassigned)
      OR (p_include_unassigned AND c.assigned_user_id IS NULL)
      OR (p_assigned_user_ids IS NOT NULL AND c.assigned_user_id = ANY(p_assigned_user_ids))
    )
    AND (
      p_tag_ids IS NULL
      OR EXISTS (
        SELECT 1 FROM public.lead_tag_assignments lta
        WHERE lta.lead_id = c.lead_id AND lta.tag_id = ANY(p_tag_ids)
      )
    )
    AND (
      p_search IS NULL OR p_search = ''
      OR c.visitor_name  ILIKE '%' || p_search || '%'
      OR c.visitor_email ILIKE '%' || p_search || '%'
      OR c.visitor_phone ILIKE '%' || p_search || '%'
      OR l.name          ILIKE '%' || p_search || '%'
      OR l.email         ILIKE '%' || p_search || '%'
      OR l.phone         ILIKE '%' || p_search || '%'
    )
  ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$function$;