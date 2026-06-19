// Helper para enfileirar/cancelar follow-ups automáticos por agente.
// Reaproveita a tabela `ai_outreach_queue` e o cron `ai-followup-cron`.

interface ScheduleArgs {
  supabase: any;
  organizationId: string;
  leadId: string;
  agentId: string;
  conversationId?: string | null;
  productId?: string | null;
  channel?: 'whatsapp' | 'instagram' | 'webchat' | string;
  // snapshot do lead
  leadData?: { name?: string; email?: string; phone?: string };
}

/**
 * Cria/atualiza um agendamento de follow-up automático após o agente enviar mensagem.
 * Idempotente por (lead_id, agent_id, status='scheduled' OR 'sent').
 */
export async function scheduleAgentFollowup(args: ScheduleArgs): Promise<void> {
  const { supabase, organizationId, leadId, agentId, conversationId, productId, channel, leadData } = args;
  if (!leadId || !agentId) return;

  // Carrega config do agente
  const { data: agent } = await supabase
    .from('product_agents')
    .select(
      'followup_enabled, followup_max_attempts, followup_intervals_minutes, ' +
      'followup_tone, followup_extra_instructions, followup_respect_business_hours, ' +
      'followup_stop_on_human, followup_stop_on_booking, followup_channels, ' +
      'followup_attempt_hints, name'
    )
    .eq('id', agentId)
    .maybeSingle();

  if (!agent?.followup_enabled) return;

  const allowedChannels: string[] = agent.followup_channels ?? ['whatsapp', 'instagram'];
  if (channel && !allowedChannels.includes(channel)) return;

  const intervals: number[] = Array.isArray(agent.followup_intervals_minutes) && agent.followup_intervals_minutes.length > 0
    ? agent.followup_intervals_minutes
    : [15, 120, 1440];
  const maxAttempts = agent.followup_max_attempts ?? intervals.length;

  const firstDelayMin = intervals[0] ?? 15;
  const nextAt = new Date(Date.now() + firstDelayMin * 60000).toISOString();

  // Buscar entrada existente (scheduled/sent) para este lead+agente
  const { data: existing } = await supabase
    .from('ai_outreach_queue')
    .select('id, status, followups_sent')
    .eq('lead_id', leadId)
    .eq('agent_id', agentId)
    .in('status', ['scheduled', 'sent'])
    .maybeSingle();

  const basePayload = {
    organization_id: organizationId,
    lead_id: leadId,
    conversation_id: conversationId ?? null,
    agent_id: agentId,
    product_id: productId ?? null,
    objective: 'Retomar contato após silêncio do lead',
    extra_context: agent.followup_extra_instructions ?? null,
    lead_data: leadData ?? {},
    status: 'sent', // 'sent' = aguardando próximo follow-up; cron já filtra por isso
    followup_enabled: true,
    followup_interval_hours: Math.max(1, Math.round((intervals[0] ?? 60) / 60)),
    followup_intervals_minutes: intervals.slice(0, maxAttempts),
    followup_attempt_hints: agent.followup_attempt_hints ?? [],
    followup_kind: 'agent_silence',
    max_followups: maxAttempts,
    next_followup_at: nextAt,
  };

  if (existing) {
    // Re-agenda mantendo contador (agente acabou de mandar nova msg => zera o contador)
    await supabase
      .from('ai_outreach_queue')
      .update({ ...basePayload, followups_sent: 0 })
      .eq('id', existing.id);
  } else {
    await supabase.from('ai_outreach_queue').insert({ ...basePayload, followups_sent: 0 });
  }
}

/**
 * Cancela follow-ups pendentes quando o lead responde, é transferido para humano,
 * faz opt-out, ou agenda reunião. Usado por todos os webhooks de entrada.
 */
export async function cancelFollowupsForLead(
  supabase: any,
  leadId: string,
  reason: 'lead_replied' | 'human_takeover' | 'opt_out' | 'booking' = 'lead_replied',
): Promise<void> {
  if (!leadId) return;
  await supabase
    .from('ai_outreach_queue')
    .update({
      status: reason === 'lead_replied' ? 'replied' : 'completed',
      followup_enabled: false,
      next_followup_at: null,
    })
    .eq('lead_id', leadId)
    .in('status', ['scheduled', 'sent']);
}
