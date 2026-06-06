-- Keep inbox previews populated from the real message history.
-- The Edge Function also has a fallback, but the denormalized columns are the
-- fast path used by inbox_list_conversations.

ALTER TABLE public.webchat_conversations
  ADD COLUMN IF NOT EXISTS last_message_content text,
  ADD COLUMN IF NOT EXISTS last_message_metadata jsonb,
  ADD COLUMN IF NOT EXISTS last_message_sender_type text,
  ADD COLUMN IF NOT EXISTS last_message_created_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_conv_id uuid;
  v_last RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_conv_id := OLD.conversation_id;
  ELSE
    v_conv_id := NEW.conversation_id;
  END IF;

  IF v_conv_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND COALESCE(NEW.is_deleted, false) = false THEN
    UPDATE public.webchat_conversations c
       SET last_message_content      = NEW.content,
           last_message_metadata     = NEW.metadata,
           last_message_sender_type  = NEW.sender_type,
           last_message_created_at   = NEW.created_at,
           last_message_at           = NEW.created_at
     WHERE c.id = v_conv_id
       AND (
         c.last_message_created_at IS NULL
         OR NEW.created_at >= c.last_message_created_at
       );
    RETURN NEW;
  END IF;

  SELECT m.content, m.metadata, m.sender_type, m.created_at
    INTO v_last
    FROM public.webchat_messages m
    WHERE m.conversation_id = v_conv_id
      AND COALESCE(m.is_deleted, false) = false
    ORDER BY m.created_at DESC
    LIMIT 1;

  UPDATE public.webchat_conversations c
     SET last_message_content      = v_last.content,
         last_message_metadata     = v_last.metadata,
         last_message_sender_type  = v_last.sender_type,
         last_message_created_at   = v_last.created_at,
         last_message_at           = COALESCE(v_last.created_at, c.last_message_at)
   WHERE c.id = v_conv_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conversation_last_message ON public.webchat_messages;
CREATE TRIGGER trg_sync_conversation_last_message
AFTER INSERT OR UPDATE OR DELETE ON public.webchat_messages
FOR EACH ROW
EXECUTE FUNCTION public.sync_conversation_last_message();

WITH latest AS (
  SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id,
         m.content,
         m.metadata,
         m.sender_type,
         m.created_at
    FROM public.webchat_messages m
    WHERE COALESCE(m.is_deleted, false) = false
    ORDER BY m.conversation_id, m.created_at DESC
)
UPDATE public.webchat_conversations c
   SET last_message_content      = latest.content,
       last_message_metadata     = latest.metadata,
       last_message_sender_type  = latest.sender_type,
       last_message_created_at   = latest.created_at,
       last_message_at           = latest.created_at
  FROM latest
 WHERE c.id = latest.conversation_id
   AND (
     c.last_message_created_at IS DISTINCT FROM latest.created_at
     OR c.last_message_content IS DISTINCT FROM latest.content
     OR c.last_message_metadata IS DISTINCT FROM latest.metadata
     OR c.last_message_sender_type IS DISTINCT FROM latest.sender_type
   );
