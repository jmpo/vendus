
-- Fix function search_path mutable warnings
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.normalize_phone_br(text) SET search_path = public;

-- Tighten overly-permissive INSERT policies on log tables to service_role only
DROP POLICY IF EXISTS "Service role can insert webhook logs" ON public.funnel_webhook_logs;
CREATE POLICY "Service role can insert webhook logs"
ON public.funnel_webhook_logs
FOR INSERT
TO service_role
WITH CHECK (true);

DROP POLICY IF EXISTS "System can insert webhook logs" ON public.webhook_logs;
CREATE POLICY "System can insert webhook logs"
ON public.webhook_logs
FOR INSERT
TO service_role
WITH CHECK (true);

-- Add explicit service-role policies for internal dedup tables that had RLS on but no policies
CREATE POLICY "Service role manages processing locks"
ON public.conversation_processing_locks
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Service role manages processed messages"
ON public.processed_messages
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Service role manages sent responses"
ON public.sent_responses
FOR ALL
TO service_role
USING (true) WITH CHECK (true);
