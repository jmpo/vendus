-- Conversación única POR CONEXIÓN (no solo por teléfono).
-- Antes: UNIQUE (org, channel, visitor_phone_normalized) → forzaba 1 sola conversación
-- abierta por teléfono, aunque llegara por conexiones/números distintos (se fusionaban).
-- Con conexiones ilimitadas eso es incorrecto: el mismo contacto puede tener una
-- conversación separada por cada número/conexión. Agregamos la conexión a la clave.
DROP INDEX IF EXISTS public.webchat_conv_open_phone_unique;
CREATE UNIQUE INDEX webchat_conv_open_phone_unique
  ON public.webchat_conversations
  (organization_id, channel, visitor_phone_normalized,
   COALESCE(meta_connection_id::text, evolution_instance_id::text, zernio_connection_id::text, 'none'))
  WHERE (status <> 'closed'::webchat_conversation_status
         AND visitor_phone_normalized IS NOT NULL
         AND visitor_phone_normalized <> '');
