
-- 1) funnel_analytics: drop anon write policies (writes happen via SECURITY DEFINER increment_funnel_leads)
DROP POLICY IF EXISTS "Anon can update analytics" ON public.funnel_analytics;
DROP POLICY IF EXISTS "Anon can insert analytics" ON public.funnel_analytics;

-- 2) booking_requests: remove broken token policy, move to validated RPCs
DROP POLICY IF EXISTS "Public can cancel or reschedule by token" ON public.booking_requests;

CREATE OR REPLACE FUNCTION public.cancel_booking_by_token(p_token text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking RECORD;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  SELECT id, calendar_event_id, status
    INTO v_booking
  FROM public.booking_requests
  WHERE confirmation_token = p_token
  LIMIT 1;

  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true);
  END IF;

  UPDATE public.booking_requests
     SET status = 'cancelled',
         cancellation_reason = p_reason
   WHERE id = v_booking.id;

  IF v_booking.calendar_event_id IS NOT NULL THEN
    UPDATE public.calendar_events
       SET status = 'cancelled'
     WHERE id = v_booking.calendar_event_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_booking.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_booking_by_token(
  p_token text,
  p_new_start_time timestamptz,
  p_timezone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking RECORD;
  v_duration int;
  v_new_end timestamptz;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;
  IF p_new_start_time IS NULL OR p_timezone IS NULL THEN
    RAISE EXCEPTION 'Missing parameters';
  END IF;

  SELECT br.id, br.calendar_event_id, bet.duration_minutes
    INTO v_booking
  FROM public.booking_requests br
  JOIN public.booking_event_types bet ON bet.id = br.event_type_id
  WHERE br.confirmation_token = p_token
  LIMIT 1;

  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  v_duration := COALESCE(v_booking.duration_minutes, 30);
  v_new_end := p_new_start_time + make_interval(mins => v_duration);

  UPDATE public.booking_requests
     SET start_time = p_new_start_time,
         end_time   = v_new_end,
         timezone   = p_timezone,
         status     = CASE WHEN status = 'cancelled' THEN 'confirmed' ELSE status END
   WHERE id = v_booking.id;

  IF v_booking.calendar_event_id IS NOT NULL THEN
    UPDATE public.calendar_events
       SET start_time = p_new_start_time,
           end_time   = v_new_end
     WHERE id = v_booking.calendar_event_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_booking.id, 'end_time', v_new_end);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_booking_by_token(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_by_token(text, timestamptz, text) TO anon, authenticated;

-- 3) webchat_messages: tighten INSERT to require same organization
DROP POLICY IF EXISTS "Users can insert messages to their org conversations" ON public.webchat_messages;
CREATE POLICY "Users can insert messages to their org conversations"
ON public.webchat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.webchat_conversations c
    WHERE c.id = webchat_messages.conversation_id
      AND (
        c.organization_id = public.get_user_organization(auth.uid())
        OR public.is_super_admin(auth.uid())
      )
  )
);

-- 4) user_availability: drop public-anon read, allow public read only for hosts with active public booking event types; team can read own org
DROP POLICY IF EXISTS "Anyone can view user availability" ON public.user_availability;

CREATE POLICY "Public can view availability of bookable hosts"
ON public.user_availability
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.booking_event_types bet
    WHERE bet.user_id = user_availability.user_id
      AND bet.is_active = true
  )
);

CREATE POLICY "Team can view availability in same organization"
ON public.user_availability
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_organization(auth.uid())
  OR public.is_super_admin(auth.uid())
);

-- 5) Views: enforce caller permissions (security_invoker)
ALTER VIEW public.platform_branding_public SET (security_invoker = true);
ALTER VIEW public.public_booking_profiles SET (security_invoker = true);
ALTER VIEW public.v_agent_quality_30d SET (security_invoker = true);
