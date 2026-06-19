-- Columnas de Instagram Direct en webchat_conversations.
-- El código (webchat-inbox/action=send, instagram-send, instagram-webhook) las
-- referencia, pero faltaban en el esquema → el .select() de envío fallaba y el
-- inbox devolvía 404 ("Conversation not found"), rompiendo el envío manual.
-- Idempotente: seguro de reaplicar.
ALTER TABLE public.webchat_conversations
  ADD COLUMN IF NOT EXISTS ig_sender_id text;

ALTER TABLE public.webchat_conversations
  ADD COLUMN IF NOT EXISTS instagram_connection_id uuid;
