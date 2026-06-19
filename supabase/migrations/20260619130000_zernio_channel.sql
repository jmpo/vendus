-- Canal Zernio (WhatsApp oficial gestionado). Aditivo/idempotente.
-- Modelo igual al de Meta: ventana 24h + templates para iniciar; números virtuales.

-- 1) Conexiones Zernio por organización (API key cifrada en reposo)
CREATE TABLE IF NOT EXISTS public.zernio_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_name text,
  account_id text NOT NULL,                 -- Zernio account _id (whatsapp)
  api_key_encrypted text NOT NULL,          -- AES-256-GCM (meta-crypto)
  phone_number text,                         -- número virtual (display)
  webhook_secret text,                       -- secret para verificar X-Zernio-Signature
  webhook_subscribed_at timestamptz,
  status text NOT NULL DEFAULT 'active',     -- active | disconnected
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_zernio_connections_org ON public.zernio_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_zernio_connections_account ON public.zernio_connections(account_id);

ALTER TABLE public.zernio_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zernio_connections' AND policyname='zernio_conn_org_select') THEN
    CREATE POLICY zernio_conn_org_select ON public.zernio_connections
      FOR SELECT USING (public.user_belongs_to_organization(auth.uid(), organization_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zernio_connections' AND policyname='zernio_conn_org_all') THEN
    CREATE POLICY zernio_conn_org_all ON public.zernio_connections
      FOR ALL USING (public.user_belongs_to_organization(auth.uid(), organization_id))
      WITH CHECK (public.user_belongs_to_organization(auth.uid(), organization_id));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.zernio_connections TO authenticated;

-- 2) Columnas en webchat_conversations para enrutar/identificar conversas de Zernio
ALTER TABLE public.webchat_conversations
  ADD COLUMN IF NOT EXISTS zernio_connection_id uuid REFERENCES public.zernio_connections(id) ON DELETE SET NULL;
ALTER TABLE public.webchat_conversations
  ADD COLUMN IF NOT EXISTS zernio_conversation_id text;

CREATE INDEX IF NOT EXISTS idx_webchat_conv_zernio_conn ON public.webchat_conversations(zernio_connection_id);
