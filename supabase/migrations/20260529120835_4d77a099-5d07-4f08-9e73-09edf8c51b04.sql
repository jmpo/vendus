
-- Cadence API keys for public REST access
CREATE TABLE public.cadence_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['cadences:read','cadences:write']::text[],
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_api_keys TO authenticated;
GRANT ALL ON public.cadence_api_keys TO service_role;

ALTER TABLE public.cadence_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins manage their api keys"
ON public.cadence_api_keys
FOR ALL
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  )
  AND (
    public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin')
  )
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  )
  AND (
    public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE INDEX idx_cadence_api_keys_org ON public.cadence_api_keys(organization_id);
CREATE INDEX idx_cadence_api_keys_hash ON public.cadence_api_keys(key_hash);
