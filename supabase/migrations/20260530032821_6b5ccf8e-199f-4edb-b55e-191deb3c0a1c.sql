
ALTER TABLE public.capture_funnels
  ADD COLUMN IF NOT EXISTS channel_type text NOT NULL DEFAULT 'widget';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capture_funnels_channel_type_check'
  ) THEN
    ALTER TABLE public.capture_funnels
      ADD CONSTRAINT capture_funnels_channel_type_check
      CHECK (channel_type IN ('chatbot','whatsapp','form','widget','quiz'));
  END IF;
END $$;

-- Backfill: infere o canal a partir do JSON `channels`
UPDATE public.capture_funnels
SET channel_type = CASE
  WHEN (channels->'widget'->>'enabled')::boolean = true THEN 'widget'
  WHEN (channels->'chat'->>'enabled')::boolean   = true THEN 'chatbot'
  WHEN (channels->'form'->>'enabled')::boolean   = true THEN 'form'
  WHEN (channels->'whatsapp'->>'enabled')::boolean = true THEN 'whatsapp'
  WHEN (channels->'quiz'->>'enabled')::boolean   = true THEN 'quiz'
  ELSE 'widget'
END
WHERE channel_type = 'widget'; -- só os que ficaram no default

CREATE INDEX IF NOT EXISTS idx_capture_funnels_channel
  ON public.capture_funnels(organization_id, channel_type);
