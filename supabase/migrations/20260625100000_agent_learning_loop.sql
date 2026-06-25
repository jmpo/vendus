-- "Cerebro que aprende": el agente aprende de conversaciones que CIERRAN (test drive
-- agendado / venta ganada) y aplica esos aprendizajes en futuras charlas.
-- Inspirado en la memoria auto-mejorable de Hermes (Nous Research), adaptado a ventas.
-- Loop: capturar trayectorias -> destilar aprendizajes -> inyectar al prompt -> exportar.

-- 1) TRAYECTORIAS: snapshot de conversaciones con su RESULTADO. Materia prima del
--    aprendizaje + dataset exportable para fine-tuning futuro (punto 3 de Hermes).
create table if not exists public.agent_trajectories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.webchat_conversations(id) on delete set null,
  lead_id uuid,
  agent_type text,                                  -- sdr/closer/custom… (de la conversación)
  outcome text not null check (outcome in ('booked','won','lost')),
  messages jsonb not null default '[]'::jsonb,       -- [{role, content}] recortado
  summary text,
  created_at timestamptz not null default now()
);
-- 1 trayectoria por (conversación, resultado) — el cron no re-captura lo mismo.
create unique index if not exists agent_trajectories_conv_outcome_uidx
  on public.agent_trajectories(conversation_id, outcome) where conversation_id is not null;
create index if not exists agent_trajectories_org_created_idx
  on public.agent_trajectories(organization_id, created_at desc);

-- 2) APRENDIZAJES: insights destilados que se inyectan al prompt del agente (punto 1).
create table if not exists public.agent_learnings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_type text,                                  -- null = aplica a todos los roles
  category text,                                    -- objecion | cierre | agendamiento | general
  insight text not null,                            -- aprendizaje accionable y corto
  evidence_count int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_learnings_org_active_idx
  on public.agent_learnings(organization_id) where active;

-- RLS: miembros de la org LEEN; admins curan; el service_role (cron/bot) hace todo.
alter table public.agent_trajectories enable row level security;
alter table public.agent_learnings enable row level security;

drop policy if exists "org members read trajectories" on public.agent_trajectories;
create policy "org members read trajectories" on public.agent_trajectories
  for select using (organization_id = public.get_user_organization(auth.uid()));

drop policy if exists "org members read learnings" on public.agent_learnings;
create policy "org members read learnings" on public.agent_learnings
  for select using (organization_id = public.get_user_organization(auth.uid()));

-- Curar (editar/desactivar) lo que el agente aprendió, dentro de la propia org.
drop policy if exists "org members curate learnings" on public.agent_learnings;
create policy "org members curate learnings" on public.agent_learnings
  for update using (organization_id = public.get_user_organization(auth.uid()))
  with check (organization_id = public.get_user_organization(auth.uid()));

-- El superadmin de la plataforma LEE todo (para aprender sobre todas las empresas).
drop policy if exists "super admin reads all learnings" on public.agent_learnings;
create policy "super admin reads all learnings" on public.agent_learnings
  for select using (public.is_super_admin(auth.uid()));
drop policy if exists "super admin reads all trajectories" on public.agent_trajectories;
create policy "super admin reads all trajectories" on public.agent_trajectories
  for select using (public.is_super_admin(auth.uid()));

grant select on public.agent_trajectories to authenticated;
grant select, update on public.agent_learnings to authenticated;

-- NOTA: el cron 'agent-learning-cron' se programa en pg_cron (no en migración):
-- select cron.schedule('agent-learning-cron', '0 6 * * *', $job$
--   select net.http_post(
--     url:='https://jtdvnyqxhsrtqpamtepz.supabase.co/functions/v1/agent-learning-cron',
--     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
--     body:='{}'::jsonb) $job$);
