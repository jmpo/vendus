
-- ============ platform_settings: chave-mestre de criptografia ============
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS meta_wa_master_key text;

CREATE OR REPLACE FUNCTION public.get_or_create_meta_master_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  settings_id uuid;
BEGIN
  SELECT id, meta_wa_master_key INTO settings_id, k FROM public.platform_settings LIMIT 1;
  IF settings_id IS NULL THEN
    INSERT INTO public.platform_settings DEFAULT VALUES RETURNING id INTO settings_id;
  END IF;
  IF k IS NULL OR length(k) = 0 THEN
    k := encode(gen_random_bytes(32), 'base64');
    UPDATE public.platform_settings SET meta_wa_master_key = k WHERE id = settings_id;
  END IF;
  RETURN k;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_meta_master_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_meta_master_key() TO service_role;

-- ============ whatsapp_meta_connections ============
CREATE TABLE public.whatsapp_meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  phone_number text,
  phone_number_id text NOT NULL,
  waba_id text NOT NULL,
  business_account_name text,
  app_id text NOT NULL,
  app_secret_encrypted text NOT NULL,
  access_token_encrypted text NOT NULL,
  webhook_verify_token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','error','revoked')),
  last_error text,
  last_health_check_at timestamptz,
  quality_rating text,
  messaging_limit_tier text,
  default_reengagement_template_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone_number_id)
);

CREATE INDEX idx_wameta_conn_org ON public.whatsapp_meta_connections(organization_id);
CREATE INDEX idx_wameta_conn_phone_id ON public.whatsapp_meta_connections(phone_number_id);
CREATE INDEX idx_wameta_conn_verify_token ON public.whatsapp_meta_connections(webhook_verify_token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_meta_connections TO authenticated;
GRANT ALL ON public.whatsapp_meta_connections TO service_role;

ALTER TABLE public.whatsapp_meta_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wameta_conn_select" ON public.whatsapp_meta_connections
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.user_belongs_to_organization(auth.uid(), organization_id));

CREATE POLICY "wameta_conn_insert" ON public.whatsapp_meta_connections
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.user_belongs_to_organization(auth.uid(), organization_id));

CREATE POLICY "wameta_conn_update" ON public.whatsapp_meta_connections
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.user_belongs_to_organization(auth.uid(), organization_id));

CREATE POLICY "wameta_conn_delete" ON public.whatsapp_meta_connections
  FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.user_belongs_to_organization(auth.uid(), organization_id));

CREATE TRIGGER trg_wameta_conn_updated_at
  BEFORE UPDATE ON public.whatsapp_meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ whatsapp_meta_templates ============
CREATE TABLE public.whatsapp_meta_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.whatsapp_meta_connections(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meta_template_id text,
  name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('APPROVED','PENDING','REJECTED','PAUSED','DISABLED','IN_APPEAL','APPROVED_PAUSED')),
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_score jsonb,
  rejected_reason text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, name, language)
);

CREATE INDEX idx_wameta_tpl_conn ON public.whatsapp_meta_templates(connection_id);
CREATE INDEX idx_wameta_tpl_org ON public.whatsapp_meta_templates(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_meta_templates TO authenticated;
GRANT ALL ON public.whatsapp_meta_templates TO service_role;

ALTER TABLE public.whatsapp_meta_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wameta_tpl_select" ON public.whatsapp_meta_templates
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.user_belongs_to_organization(auth.uid(), organization_id));

CREATE POLICY "wameta_tpl_modify" ON public.whatsapp_meta_templates
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.user_belongs_to_organization(auth.uid(), organization_id))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.user_belongs_to_organization(auth.uid(), organization_id));

CREATE TRIGGER trg_wameta_tpl_updated_at
  BEFORE UPDATE ON public.whatsapp_meta_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.whatsapp_meta_connections
  ADD CONSTRAINT fk_wameta_default_tpl
  FOREIGN KEY (default_reengagement_template_id)
  REFERENCES public.whatsapp_meta_templates(id) ON DELETE SET NULL;

-- ============ whatsapp_meta_webhook_logs ============
CREATE TABLE public.whatsapp_meta_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES public.whatsapp_meta_connections(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text,
  payload jsonb,
  processed boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wameta_log_conn ON public.whatsapp_meta_webhook_logs(connection_id, created_at DESC);
CREATE INDEX idx_wameta_log_created ON public.whatsapp_meta_webhook_logs(created_at);

GRANT SELECT ON public.whatsapp_meta_webhook_logs TO authenticated;
GRANT ALL ON public.whatsapp_meta_webhook_logs TO service_role;

ALTER TABLE public.whatsapp_meta_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wameta_log_select" ON public.whatsapp_meta_webhook_logs
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.user_belongs_to_organization(auth.uid(), organization_id));

-- ============ Colunas em webchat_* ============
ALTER TABLE public.webchat_conversations
  ADD COLUMN IF NOT EXISTS meta_connection_id uuid REFERENCES public.whatsapp_meta_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_webchat_conv_meta_conn
  ON public.webchat_conversations(meta_connection_id) WHERE meta_connection_id IS NOT NULL;

ALTER TABLE public.webchat_messages
  ADD COLUMN IF NOT EXISTS meta_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_status text;

CREATE UNIQUE INDEX IF NOT EXISTS webchat_messages_meta_msg_uniq
  ON public.webchat_messages(conversation_id, meta_message_id)
  WHERE meta_message_id IS NOT NULL;

-- ============ Janela 24h ============
CREATE OR REPLACE FUNCTION public.is_within_24h_window(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT last_inbound_at > now() - interval '24 hours'
     FROM public.webchat_conversations WHERE id = _conversation_id),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_within_24h_window(uuid) TO authenticated, service_role;
