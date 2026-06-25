-- Ficha de memoria por cliente: hechos destilados (uso, familia, presupuesto, objeción,
-- modelos de interés, etapa…) que SOBREVIVEN al recorte de 40 mensajes y van siempre al
-- prompt del agente. Inspirado en el user-modeling de Hermes, adaptado a ventas.
-- La mantiene la edge function lead-memory-update (en background, con throttle).
create table if not exists public.lead_memory (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  summary text,                               -- ficha en prosa corta (lo que ve el vendedor + va al prompt)
  facts jsonb not null default '{}'::jsonb,    -- estructurado: { uso, ocupantes, presupuesto, ... }
  msg_count int not null default 0,            -- nº de mensajes al momento de la última destilación (throttle)
  updated_at timestamptz not null default now()
);
create index if not exists lead_memory_org_idx on public.lead_memory(organization_id);

alter table public.lead_memory enable row level security;

drop policy if exists "org members read lead_memory" on public.lead_memory;
create policy "org members read lead_memory" on public.lead_memory
  for select using (
    organization_id = public.get_user_organization(auth.uid())
    or public.is_super_admin(auth.uid())
  );

drop policy if exists "org members update lead_memory" on public.lead_memory;
create policy "org members update lead_memory" on public.lead_memory
  for update using (organization_id = public.get_user_organization(auth.uid()))
  with check (organization_id = public.get_user_organization(auth.uid()));

grant select, update on public.lead_memory to authenticated;
