
-- ============ CADENCES MODULE ============

-- 1) Add category to existing campaign_contexts (Biblioteca de Contextos)
ALTER TABLE public.campaign_contexts
  ADD COLUMN IF NOT EXISTS category text;

-- 2) Cadences (template)
CREATE TABLE IF NOT EXISTS public.cadences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  objective text,
  agent_id uuid,
  status text NOT NULL DEFAULT 'draft',
  entry_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  exclusion_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  stop_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  stop_actions jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_window jsonb NOT NULL DEFAULT '{"days":["mon","tue","wed","thu","fri"],"start":"09:00","end":"18:00","randomize":false}'::jsonb,
  channel text NOT NULL DEFAULT 'whatsapp',
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_executed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cadences_status_chk CHECK (status IN ('draft','active','paused','archived'))
);
CREATE INDEX IF NOT EXISTS idx_cadences_org_status ON public.cadences(organization_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadences TO authenticated;
GRANT ALL ON public.cadences TO service_role;
ALTER TABLE public.cadences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cadences_org_access" ON public.cadences
  TO authenticated
  USING (user_belongs_to_organization(auth.uid(), organization_id) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (user_belongs_to_organization(auth.uid(), organization_id) OR has_role(auth.uid(), 'super_admin'::app_role));
CREATE TRIGGER trg_cadences_updated_at BEFORE UPDATE ON public.cadences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Cadence steps
CREATE TABLE IF NOT EXISTS public.cadence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence_id uuid NOT NULL REFERENCES public.cadences(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  name text NOT NULL,
  objective text,
  execute_immediately boolean NOT NULL DEFAULT false,
  delay_value int NOT NULL DEFAULT 1,
  delay_unit text NOT NULL DEFAULT 'days',
  delay_from text NOT NULL DEFAULT 'previous_step',
  context_id uuid REFERENCES public.campaign_contexts(id) ON DELETE SET NULL,
  context_inline text,
  tone text,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cadence_steps_delay_unit_chk CHECK (delay_unit IN ('minutes','hours','days')),
  CONSTRAINT cadence_steps_delay_from_chk CHECK (delay_from IN ('previous_step','enrollment'))
);
CREATE INDEX IF NOT EXISTS idx_cadence_steps_cadence ON public.cadence_steps(cadence_id, order_index);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_steps TO authenticated;
GRANT ALL ON public.cadence_steps TO service_role;
ALTER TABLE public.cadence_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cadence_steps_org_access" ON public.cadence_steps
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cadences c WHERE c.id = cadence_id AND (user_belongs_to_organization(auth.uid(), c.organization_id) OR has_role(auth.uid(), 'super_admin'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cadences c WHERE c.id = cadence_id AND (user_belongs_to_organization(auth.uid(), c.organization_id) OR has_role(auth.uid(), 'super_admin'::app_role))));
CREATE TRIGGER trg_cadence_steps_updated_at BEFORE UPDATE ON public.cadence_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Cadence enrollments (lead × cadence)
CREATE TABLE IF NOT EXISTS public.cadence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence_id uuid NOT NULL REFERENCES public.cadences(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_step_id uuid REFERENCES public.cadence_steps(id) ON DELETE SET NULL,
  current_step_index int NOT NULL DEFAULT 0,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  source text,
  source_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cadence_enrollments_status_chk CHECK (status IN ('active','completed','stopped','paused'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cadence_enrollments_unique_active
  ON public.cadence_enrollments(cadence_id, lead_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_cadence_enrollments_org ON public.cadence_enrollments(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_cadence_enrollments_lead ON public.cadence_enrollments(lead_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_enrollments TO authenticated;
GRANT ALL ON public.cadence_enrollments TO service_role;
ALTER TABLE public.cadence_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cadence_enrollments_org_access" ON public.cadence_enrollments
  TO authenticated
  USING (user_belongs_to_organization(auth.uid(), organization_id) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (user_belongs_to_organization(auth.uid(), organization_id) OR has_role(auth.uid(), 'super_admin'::app_role));
CREATE TRIGGER trg_cadence_enrollments_updated_at BEFORE UPDATE ON public.cadence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Step runs (individual scheduled executions)
CREATE TABLE IF NOT EXISTS public.cadence_step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.cadence_enrollments(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.cadence_steps(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  executed_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled',
  agent_message text,
  conversation_id uuid,
  skip_reason text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cadence_step_runs_status_chk CHECK (status IN ('scheduled','sent','skipped','failed','responded'))
);
CREATE INDEX IF NOT EXISTS idx_cadence_step_runs_due ON public.cadence_step_runs(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_cadence_step_runs_enrollment ON public.cadence_step_runs(enrollment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_step_runs TO authenticated;
GRANT ALL ON public.cadence_step_runs TO service_role;
ALTER TABLE public.cadence_step_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cadence_step_runs_org_access" ON public.cadence_step_runs
  TO authenticated
  USING (user_belongs_to_organization(auth.uid(), organization_id) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (user_belongs_to_organization(auth.uid(), organization_id) OR has_role(auth.uid(), 'super_admin'::app_role));
CREATE TRIGGER trg_cadence_step_runs_updated_at BEFORE UPDATE ON public.cadence_step_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Integrations: post-action FK on campaigns and forms
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS post_cadence_id uuid REFERENCES public.cadences(id) ON DELETE SET NULL;
ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS post_cadence_id uuid REFERENCES public.cadences(id) ON DELETE SET NULL;
