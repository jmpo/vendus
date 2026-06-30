-- Traza de ejecución por turno del bot (auditoría tipo Oryntra agent_runs/agent_logs).
-- Un registro por respuesta del agente: orquestador → tools (con latencia) → guardrails →
-- modelo/tokens/costo → respuesta/error. Para análisis y debug por conversación.
create table if not exists public.agent_run_traces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid,
  product_id uuid,
  lead_id uuid,
  agent_id uuid,
  agent_name text,
  trigger text,
  channel text,
  user_message text,
  response_preview text,
  orchestrator jsonb not null default '{}'::jsonb,   -- { state, intent, in_triage, routed_agent }
  steps jsonb not null default '[]'::jsonb,           -- [{ seq, type, name, at_ms, duration_ms, ok, detail, error }]
  guardrails jsonb not null default '[]'::jsonb,      -- [{ name, action }]
  model text,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  total_tokens int not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  llm_ms int,                                         -- latencia de la llamada al LLM
  total_ms int,                                       -- latencia total del turno
  status text not null default 'ok',                  -- ok | error | no_response | sin_saldo
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_art_org_created on public.agent_run_traces (organization_id, created_at desc);
create index if not exists idx_art_conv on public.agent_run_traces (conversation_id, created_at desc);
create index if not exists idx_art_status on public.agent_run_traces (organization_id, status, created_at desc);

alter table public.agent_run_traces enable row level security;

-- Lectura: admins de la org + super_admin (mismas helpers que el resto del sistema).
drop policy if exists "art_read_org" on public.agent_run_traces;
create policy "art_read_org" on public.agent_run_traces for select using (
  organization_id = public.get_user_organization(auth.uid()) or public.is_super_admin(auth.uid())
);

grant select on public.agent_run_traces to authenticated;
grant all on public.agent_run_traces to service_role;
