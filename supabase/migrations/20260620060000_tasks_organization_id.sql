-- organization_id en tasks. El código lo usa en queries (KPIs admin) y en INSERTs
-- (tool de tareas del agente, opportunity-scan) → sin la columna, crear/listar tareas fallaba.
-- Faltaba por la migración Lovable. Backfill vía product → lead → user.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

UPDATE public.tasks t SET organization_id = COALESCE(
  (SELECT p.organization_id FROM public.products p WHERE p.id = t.product_id),
  (SELECT l.organization_id FROM public.leads l WHERE l.id = t.lead_id),
  (SELECT pr.organization_id FROM public.profiles pr WHERE pr.id = t.user_id)
) WHERE t.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_organization_id ON public.tasks(organization_id);
