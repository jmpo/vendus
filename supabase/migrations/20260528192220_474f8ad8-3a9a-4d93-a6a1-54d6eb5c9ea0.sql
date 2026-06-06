
-- 1) Remove a política pública que vazava todos os convites pendentes
DROP POLICY IF EXISTS "Public can view pending invitations by token" ON public.team_invitations;

-- 2) RPC SECURITY DEFINER que retorna SOMENTE o convite cujo token bate exatamente
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', ti.id,
    'email', ti.email,
    'role', ti.role,
    'squad_id', ti.squad_id,
    'organization_id', ti.organization_id,
    'token', ti.token,
    'status', ti.status,
    'expires_at', ti.expires_at,
    'created_at', ti.created_at,
    'squad', CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color) END,
    'organization', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url) END
  )
  INTO v_row
  FROM public.team_invitations ti
  LEFT JOIN public.sales_squads s ON s.id = ti.squad_id
  LEFT JOIN public.organizations o ON o.id = ti.organization_id
  WHERE ti.token = p_token
    AND ti.status = 'pending'
    AND ti.expires_at > now()
  LIMIT 1;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;

-- 3) Remover opportunity_scans do publication de Realtime para evitar
--    qualquer chance de vazamento de eventos entre organizações.
--    O frontend passa a usar polling enquanto o scan estiver em execução.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'opportunity_scans'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.opportunity_scans';
  END IF;
END $$;
