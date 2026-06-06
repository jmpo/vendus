-- 1) Defaults mais restritivos para vendedor
CREATE OR REPLACE FUNCTION public.initialize_user_permissions(p_user_id uuid, p_organization_id uuid, p_role text DEFAULT 'seller'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_permissions (user_id, organization_id,
    view_queue_conversations, view_other_users_conversations, view_other_queues_conversations,
    allow_close_pending_tickets, view_all_contacts, allow_pipeline,
    allow_manage_client_portfolio, view_all_kanban_cards, view_all_schedules,
    allow_dashboard, allow_inbox_panel, allow_groups, allow_connection_actions,
    view_unassigned_sector_tickets, view_schedules_mode)
  VALUES (
    p_user_id, p_organization_id,
    -- view_queue_conversations: somente admin/manager por padrão
    CASE WHEN p_role IN ('admin','manager') THEN true ELSE false END,
    CASE WHEN p_role IN ('admin','manager') THEN true ELSE false END,
    CASE WHEN p_role IN ('admin','manager') THEN true ELSE false END,
    -- allow_close_pending_tickets: somente admin/manager
    CASE WHEN p_role IN ('admin','manager') THEN true ELSE false END,
    CASE WHEN p_role IN ('admin', 'manager') THEN true ELSE false END,
    CASE WHEN p_role IN ('admin', 'manager') THEN true ELSE false END,
    CASE WHEN p_role IN ('admin', 'manager') THEN true ELSE false END,
    CASE WHEN p_role IN ('admin', 'manager') THEN true ELSE false END,
    CASE WHEN p_role IN ('admin', 'manager') THEN true ELSE false END,
    CASE WHEN p_role IN ('admin', 'manager') THEN true ELSE false END,
    -- allow_inbox_panel: vendedor precisa abrir a Central
    true,
    CASE WHEN p_role IN ('admin', 'manager') THEN true ELSE false END,
    CASE WHEN p_role = 'admin' THEN true ELSE false END,
    -- view_unassigned_sector_tickets: somente admin/manager
    CASE WHEN p_role IN ('admin','manager') THEN true ELSE false END,
    CASE WHEN p_role IN ('admin', 'manager') THEN 'all' ELSE 'mine_only' END
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_notification_settings (user_id, organization_id)
  VALUES (p_user_id, p_organization_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$function$;

-- 2) Backfill: aplica novos defaults somente em vendedores criados nas últimas 24h
UPDATE public.user_permissions up
SET view_queue_conversations = false,
    view_unassigned_sector_tickets = false,
    allow_close_pending_tickets = false
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = up.user_id AND ur.role = 'seller'::public.app_role
)
AND NOT EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = up.user_id AND ur.role IN ('admin'::public.app_role, 'manager'::public.app_role, 'super_admin'::public.app_role)
)
AND up.created_at > now() - interval '24 hours';

-- 3) Nova RLS policy: "Ver todos os cards do Kanban" libera leitura de todos os leads da org
CREATE POLICY "Users with view_all_kanban_cards can view all org leads"
ON public.leads
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_organization(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.user_permissions up
    WHERE up.user_id = auth.uid()
      AND up.view_all_kanban_cards = true
  )
);