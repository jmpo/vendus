
CREATE TABLE public.instagram_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  created_by uuid,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','error','revoked')),
  app_id text,
  app_secret_encrypted bytea,
  fb_page_id text,
  fb_page_name text,
  ig_business_account_id text,
  ig_username text,
  page_access_token_encrypted bytea,
  webhook_verify_token text NOT NULL,
  webhook_subscribed_at timestamptz,
  last_inbound_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.instagram_connections TO authenticated;
GRANT ALL ON public.instagram_connections TO service_role;

ALTER TABLE public.instagram_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ig_conn_member_select" ON public.instagram_connections
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "ig_conn_member_insert" ON public.instagram_connections
  FOR INSERT TO authenticated
  WITH CHECK (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "ig_conn_member_update" ON public.instagram_connections
  FOR UPDATE TO authenticated
  USING (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "ig_conn_member_delete" ON public.instagram_connections
  FOR DELETE TO authenticated
  USING (public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_ig_conn_org ON public.instagram_connections(organization_id);
CREATE UNIQUE INDEX uq_ig_conn_iba_active ON public.instagram_connections(ig_business_account_id) WHERE status = 'active';

CREATE TRIGGER trg_ig_conn_updated_at
  BEFORE UPDATE ON public.instagram_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.instagram_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  connection_id uuid REFERENCES public.instagram_connections(id) ON DELETE CASCADE,
  payload jsonb,
  event_type text,
  object text,
  sender_id text,
  recipient_id text,
  message_id text,
  signature_valid boolean,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.instagram_webhook_logs TO authenticated;
GRANT ALL ON public.instagram_webhook_logs TO service_role;

ALTER TABLE public.instagram_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ig_logs_member_select" ON public.instagram_webhook_logs
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.user_belongs_to_organization(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_ig_logs_conn ON public.instagram_webhook_logs(connection_id);
CREATE INDEX idx_ig_logs_created ON public.instagram_webhook_logs(created_at DESC);
