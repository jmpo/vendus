-- Fiabilidad de mensajería: índices para lookups calientes.
-- 1) El webhook de entrega (Zernio) actualiza delivery_status buscando por
--    metadata->>'zernio_message_id' → sin índice era O(n) scan.
-- 2) El health-check y el reintento buscan mensajes salientes fallidos por delivery_status.

CREATE INDEX IF NOT EXISTS idx_webchat_messages_zernio_msg_id
  ON public.webchat_messages ((metadata->>'zernio_message_id'))
  WHERE metadata->>'zernio_message_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webchat_messages_failed_outbound
  ON public.webchat_messages (created_at)
  WHERE delivery_status = 'failed' AND direction = 'outbound';
