CREATE TABLE IF NOT EXISTS public.quiz_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  category text NOT NULL,
  objective text,
  description text,
  thumbnail text,
  icon text,
  cover_gradient text,
  badges text[] NOT NULL DEFAULT '{}',
  estimated_time text,
  question_count integer NOT NULL DEFAULT 0,
  flow_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  appearance_json jsonb,
  settings_json jsonb,
  scoring_json jsonb,
  results_json jsonb,
  is_official boolean NOT NULL DEFAULT false,
  is_public boolean NOT NULL DEFAULT false,
  usage_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_templates_org ON public.quiz_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_quiz_templates_category ON public.quiz_templates(category);
CREATE INDEX IF NOT EXISTS idx_quiz_templates_public ON public.quiz_templates(is_public) WHERE is_public = true;

GRANT SELECT ON public.quiz_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quiz_templates TO authenticated;
GRANT ALL ON public.quiz_templates TO service_role;

ALTER TABLE public.quiz_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public/official templates are readable"
  ON public.quiz_templates FOR SELECT
  USING (
    is_public = true
    OR organization_id IS NULL
    OR (
      auth.uid() IS NOT NULL
      AND organization_id IN (
        SELECT organization_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Org members can create templates"
  ON public.quiz_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Org members can update their templates"
  ON public.quiz_templates FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Org members can delete their templates"
  ON public.quiz_templates FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE TRIGGER update_quiz_templates_updated_at
  BEFORE UPDATE ON public.quiz_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();