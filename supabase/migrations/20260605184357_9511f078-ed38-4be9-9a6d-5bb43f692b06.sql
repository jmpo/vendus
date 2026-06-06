
-- 1) Grant anon/authenticated access to public branding view (fix external colors)
GRANT SELECT ON public.platform_branding_public TO anon, authenticated;

-- 2) Ensure realtime publishes support tables
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 3) Bootstrap-friendly self-promotion to super_admin
-- Only succeeds when NO super_admin exists yet (first user wins).
CREATE OR REPLACE FUNCTION public.promote_self_to_super_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_count int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT count(*) INTO v_count FROM public.user_roles WHERE role = 'super_admin';

  IF v_count > 0 AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_user AND role = 'super_admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'super_admin_already_exists');
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user, 'super_admin')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_self_to_super_admin() TO authenticated;
