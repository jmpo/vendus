
CREATE TABLE public.campaign_contexts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  objective TEXT,
  tone TEXT,
  cta TEXT,
  instructions TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_contexts TO authenticated;
GRANT ALL ON public.campaign_contexts TO service_role;
ALTER TABLE public.campaign_contexts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_contexts_org_access" ON public.campaign_contexts FOR ALL TO authenticated
USING (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_campaign_contexts_org ON public.campaign_contexts(organization_id);

CREATE TABLE public.campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'draft',
  agent_id UUID,
  created_by UUID,
  audience_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  exclusion_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  contexts JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_distribution TEXT NOT NULL DEFAULT 'random',
  instance_strategy TEXT NOT NULL DEFAULT 'all',
  instance_distribution JSONB NOT NULL DEFAULT '[]'::jsonb,
  speed_preset TEXT NOT NULL DEFAULT 'recommended',
  speed_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  schedule_type TEXT NOT NULL DEFAULT 'now',
  scheduled_at TIMESTAMPTZ,
  recurrence JSONB,
  post_response_actions JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags_on_response UUID[] NOT NULL DEFAULT '{}',
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_status_chk CHECK (status IN ('draft','active','paused','completed','cancelled')),
  CONSTRAINT campaigns_channel_chk CHECK (channel IN ('whatsapp')),
  CONSTRAINT campaigns_speed_preset_chk CHECK (speed_preset IN ('safe','recommended','fast','aggressive','custom')),
  CONSTRAINT campaigns_schedule_type_chk CHECK (schedule_type IN ('now','scheduled','recurring')),
  CONSTRAINT campaigns_context_dist_chk CHECK (context_distribution IN ('random','sequential','weighted')),
  CONSTRAINT campaigns_instance_strategy_chk CHECK (instance_strategy IN ('all','rotation','manual'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_org_access" ON public.campaigns FOR ALL TO authenticated
USING (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_campaigns_org_status ON public.campaigns(organization_id, status);
CREATE INDEX idx_campaigns_agent ON public.campaigns(agent_id);

CREATE TABLE public.campaign_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  context_used TEXT,
  context_id UUID,
  instance_id UUID,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  conversation_id UUID,
  outreach_queue_id UUID,
  error TEXT,
  responded_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaign_targets_status_chk CHECK (status IN ('queued','sending','sent','failed','skipped','responded','cancelled')),
  CONSTRAINT campaign_targets_unique UNIQUE (campaign_id, lead_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_targets TO authenticated;
GRANT ALL ON public.campaign_targets TO service_role;
ALTER TABLE public.campaign_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_targets_org_access" ON public.campaign_targets FOR ALL TO authenticated
USING (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_campaign_targets_dispatch ON public.campaign_targets(status, scheduled_for) WHERE status = 'queued';
CREATE INDEX idx_campaign_targets_campaign ON public.campaign_targets(campaign_id, status);
CREATE INDEX idx_campaign_targets_lead ON public.campaign_targets(lead_id);
CREATE INDEX idx_campaign_targets_conversation ON public.campaign_targets(conversation_id) WHERE conversation_id IS NOT NULL;

CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_campaign_contexts_updated_at BEFORE UPDATE ON public.campaign_contexts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.campaigns;
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_targets;
