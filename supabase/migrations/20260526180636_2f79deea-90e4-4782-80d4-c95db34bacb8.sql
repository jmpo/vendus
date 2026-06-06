
-- Radar IA: detector de oportunidades em conversas
CREATE TABLE public.opportunity_scans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  triggered_by UUID,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  schedule_id UUID,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  total_candidates INTEGER NOT NULL DEFAULT 0,
  total_analyzed INTEGER NOT NULL DEFAULT 0,
  hot_count INTEGER NOT NULL DEFAULT 0,
  warm_count INTEGER NOT NULL DEFAULT 0,
  cold_count INTEGER NOT NULL DEFAULT 0,
  lost_count INTEGER NOT NULL DEFAULT 0,
  potential_revenue NUMERIC NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_scans TO authenticated;
GRANT ALL ON public.opportunity_scans TO service_role;
ALTER TABLE public.opportunity_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view org scans" ON public.opportunity_scans FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role) OR
    (organization_id = get_user_organization(auth.uid()) AND
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  );
CREATE POLICY "Admin can insert org scans" ON public.opportunity_scans FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role) OR
    (organization_id = get_user_organization(auth.uid()) AND
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  );
CREATE POLICY "Admin can update org scans" ON public.opportunity_scans FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role) OR
    (organization_id = get_user_organization(auth.uid()) AND
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  );
CREATE POLICY "Admin can delete org scans" ON public.opportunity_scans FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role) OR
    (organization_id = get_user_organization(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role))
  );

CREATE INDEX idx_opportunity_scans_org ON public.opportunity_scans(organization_id, created_at DESC);

-- Itens classificados de cada scan
CREATE TABLE public.opportunity_scan_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES public.opportunity_scans(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  conversation_id UUID,
  lead_id UUID,
  classification TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_action TEXT,
  followup_message TEXT,
  lead_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_applied BOOLEAN NOT NULL DEFAULT false,
  action_applied_at TIMESTAMPTZ,
  action_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_scan_items TO authenticated;
GRANT ALL ON public.opportunity_scan_items TO service_role;
ALTER TABLE public.opportunity_scan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin view scan items" ON public.opportunity_scan_items FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role) OR
    (organization_id = get_user_organization(auth.uid()) AND
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  );
CREATE POLICY "Admin manage scan items" ON public.opportunity_scan_items FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role) OR
    (organization_id = get_user_organization(auth.uid()) AND
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role) OR
    (organization_id = get_user_organization(auth.uid()) AND
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  );

CREATE INDEX idx_opportunity_scan_items_scan ON public.opportunity_scan_items(scan_id);
CREATE INDEX idx_opportunity_scan_items_classification ON public.opportunity_scan_items(scan_id, classification);

-- Agendamentos
CREATE TABLE public.opportunity_scan_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notify_user_ids UUID[] DEFAULT ARRAY[]::UUID[],
  last_run_at TIMESTAMPTZ,
  last_scan_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_scan_schedules TO authenticated;
GRANT ALL ON public.opportunity_scan_schedules TO service_role;
ALTER TABLE public.opportunity_scan_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage schedules" ON public.opportunity_scan_schedules FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role) OR
    (organization_id = get_user_organization(auth.uid()) AND
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role) OR
    (organization_id = get_user_organization(auth.uid()) AND
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  );

CREATE INDEX idx_opportunity_scan_schedules_org ON public.opportunity_scan_schedules(organization_id, is_active);

CREATE TRIGGER set_updated_at_opportunity_scan_schedules
  BEFORE UPDATE ON public.opportunity_scan_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for live progress on scans
ALTER PUBLICATION supabase_realtime ADD TABLE public.opportunity_scans;
ALTER TABLE public.opportunity_scans REPLICA IDENTITY FULL;
