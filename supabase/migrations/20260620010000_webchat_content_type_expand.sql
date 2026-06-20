-- Amplía content_type para soportar documentos, video y stickers.
-- El CHECK original solo permitía ('text','image','file','audio'); enviar un PDF
-- (content_type='document') o un video reventaba el INSERT con 500.
ALTER TABLE public.webchat_messages DROP CONSTRAINT IF EXISTS webchat_messages_content_type_check;
ALTER TABLE public.webchat_messages
  ADD CONSTRAINT webchat_messages_content_type_check
  CHECK (content_type IN ('text','image','file','audio','video','document','sticker'));
