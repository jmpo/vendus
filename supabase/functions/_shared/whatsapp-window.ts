// ─────────────────────────────────────────────────────────────────────────────
// Ventana de 24h de WhatsApp — decisión de modo de envío por proveedor.
//
// Regla del canal:
//   • Evolution (no oficial): SIN límite de 24h → siempre texto libre (freeform).
//   • Meta / Zernio (API oficial de WhatsApp):
//       - Dentro de 24h del último mensaje del cliente → texto libre (freeform).
//       - Fuera de 24h → SOLO plantilla aprobada (HSM). El texto libre se rechaza.
//
// Este helper centraliza esa decisión para que el follow-up / remarketing sea
// consistente y fácil de auditar. Devuelve SIEMPRE un motivo legible para logs.
// ─────────────────────────────────────────────────────────────────────────────

export type OutreachProvider = 'meta' | 'evolution' | 'zernio' | 'none';

export interface OutreachDecision {
  provider: OutreachProvider;
  /** true=dentro de 24h, false=fuera, null=no aplica (Evolution). */
  withinWindow: boolean | null;
  /** 'freeform' = texto libre de la IA | 'template_required' = exige plantilla aprobada. */
  mode: 'freeform' | 'template_required';
  /** Motivo legible para logs/diagnóstico. */
  reason: string;
}

interface ConnLike {
  id?: string | null;
  meta_connection_id?: string | null;
  evolution_instance_id?: string | null;
  zernio_connection_id?: string | null;
}

export function resolveProvider(conv: ConnLike): OutreachProvider {
  if (conv.meta_connection_id) return 'meta';
  if (conv.evolution_instance_id) return 'evolution';
  if (conv.zernio_connection_id) return 'zernio';
  return 'none';
}

/**
 * Decide cómo se debe enviar un mensaje proactivo (follow-up/remarketing) en esta
 * conversación, respetando la ventana de 24h del canal oficial.
 */
export async function resolveOutreachDecision(
  supabase: any,
  conv: ConnLike,
): Promise<OutreachDecision> {
  const provider = resolveProvider(conv);

  // Evolution (y fallback legacy 'none' → Evolution Go): sin ventana de 24h.
  if (provider === 'evolution' || provider === 'none') {
    return { provider, withinWindow: null, mode: 'freeform', reason: 'evolution_sin_limite_24h' };
  }

  // Meta / Zernio: API oficial → aplica ventana de 24h.
  let within = false;
  try {
    if (conv.id) {
      const { data, error } = await supabase.rpc('is_within_24h_window', { _conversation_id: conv.id });
      if (error) {
        // Ante la duda, tratamos como FUERA de ventana (más seguro: usa plantilla).
        return { provider, withinWindow: false, mode: 'template_required', reason: `rpc_error:${error.message}` };
      }
      within = data === true;
    }
  } catch (e) {
    return { provider, withinWindow: false, mode: 'template_required', reason: `rpc_exception:${String(e)}` };
  }

  return within
    ? { provider, withinWindow: true, mode: 'freeform', reason: 'dentro_24h' }
    : { provider, withinWindow: false, mode: 'template_required', reason: 'fuera_24h_oficial' };
}

/** Log estructurado y greppable de la decisión de outreach. */
export function logOutreachDecision(tag: string, ctx: Record<string, unknown>, decision: OutreachDecision): void {
  console.log(`[${tag}] 📤 outreach-decision ${JSON.stringify({ ...ctx, ...decision })}`);
}
