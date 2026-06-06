
ALTER TABLE public.capture_funnels
  ADD COLUMN IF NOT EXISTS post_quiz_agent_id uuid REFERENCES public.product_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS post_quiz_cadence_id uuid REFERENCES public.cadences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS post_quiz_actions jsonb NOT NULL DEFAULT '{
    "apply_tag_ids": [],
    "hot_threshold": 70,
    "warm_threshold": 40,
    "create_deal": false,
    "notify_owner": false
  }'::jsonb;
