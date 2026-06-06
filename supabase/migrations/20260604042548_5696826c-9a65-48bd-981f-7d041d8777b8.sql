
-- Permite conexões em rascunho (sem credenciais ainda).
ALTER TABLE public.whatsapp_meta_connections
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN waba_id DROP NOT NULL,
  ALTER COLUMN app_id DROP NOT NULL,
  ALTER COLUMN app_secret_encrypted DROP NOT NULL,
  ALTER COLUMN access_token_encrypted DROP NOT NULL;

ALTER TABLE public.whatsapp_meta_connections
  ADD COLUMN IF NOT EXISTS webhook_subscribed_at timestamptz;

-- Índice único no verify_token (necessário para o GET handshake antigo).
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_meta_connections_verify_token_idx
  ON public.whatsapp_meta_connections (webhook_verify_token);
