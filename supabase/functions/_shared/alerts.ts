// Helper compartido de ALERTAS al equipo (notificaciones llamativas: campana + toast + badge).
// Centraliza: resolución de destinatarios (vendedor asignado + admins) e inserción con throttle.
// Usado por los puntos de fallo de envío (webchat-bot, zernio-webhook) y la reconciliación.

// OJO: NO existe relación FK user_roles↔profiles en el schema → el join PostgREST
// `profiles!inner(...)` falla en silencio y devuelve []. Resolvemos en DOS pasos:
//  1) ids con rol admin/manager/super_admin   2) filtrar por organización vía profiles.
export async function orgAdminIds(sb: any, organizationId: string): Promise<string[]> {
  try {
    const { data: roles } = await sb.from("user_roles")
      .select("user_id, role").in("role", ["admin", "manager", "super_admin"]);
    const ids = Array.from(new Set((roles || []).map((r: any) => r.user_id).filter(Boolean)));
    if (!ids.length) return [];
    const { data: profs } = await sb.from("profiles")
      .select("id").in("id", ids).eq("organization_id", organizationId);
    return (profs || []).map((p: any) => p.id);
  } catch { return []; }
}

// Destinatarios para un problema de UNA conversación: el vendedor asignado (si hay) + los admins.
export async function conversationAlertRecipients(
  sb: any,
  conversationId: string | null | undefined,
  organizationId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  if (conversationId) {
    try {
      const { data: conv } = await sb.from("webchat_conversations")
        .select("assigned_user_id").eq("id", conversationId).maybeSingle();
      if (conv?.assigned_user_id) ids.add(conv.assigned_user_id);
    } catch { /* */ }
  }
  for (const a of await orgAdminIds(sb, organizationId)) ids.add(a);
  return Array.from(ids);
}

// Alerta LLAMATIVA de que un envío a un cliente FALLÓ (no llegó). Throttle por throttleKey.
// Devuelve true si insertó (false si throttled o sin destinatarios).
export async function notifySendFailure(sb: any, opts: {
  organizationId: string;
  conversationId?: string | null;
  who?: string | null;       // nombre/teléfono del cliente
  what?: string;             // "la foto del Citroën Basalt", "el mensaje"…
  reason: string;            // motivo legible
  throttleKey: string;       // ej: `send_fail:${conversationId}` → 1 alerta/10min por conversación
  windowMs?: number;         // ventana de throttle (default 10 min)
  productId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const recipients = await conversationAlertRecipients(sb, opts.conversationId, opts.organizationId);
    if (!recipients.length) return false;

    const windowMs = opts.windowMs ?? 10 * 60 * 1000;
    const { data: recent } = await sb.from("notifications")
      .select("id").eq("metadata->>throttle_key", opts.throttleKey)
      .gte("created_at", new Date(Date.now() - windowMs).toISOString()).limit(1);
    if (recent && recent.length) return false;

    const who = opts.who ? ` a ${opts.who}` : "";
    const what = opts.what || "un mensaje";
    const rows = recipients.map((uid) => ({
      user_id: uid,
      type: "urgency",
      title: "⛔ Un mensaje NO se entregó",
      message: `No se pudo enviar ${what}${who}: ${opts.reason}. Entrá a la conversación y reenvialo.`,
      action_url: "/?tab=inbox",
      product_id: opts.productId ?? null,
      metadata: {
        kind: "send_failure",
        throttle_key: opts.throttleKey,
        conversation_id: opts.conversationId ?? null,
        ...(opts.metadata || {}),
      },
    }));
    const { error } = await sb.from("notifications").insert(rows);
    if (error) { console.error("[alerts] insert failed", error.message); return false; }
    return true;
  } catch (e) {
    console.error("[alerts] notifySendFailure failed", e);
    return false;
  }
}

// ⛔ Alerta CRÍTICA: la IA no puede responder por un problema de RECURSOS DE PAGO
// (sin saldo / créditos agotados / key inválida). Cuando esto pasa, TODOS los clientes dejan
// de recibir respuestas automáticas → hay que avisar al admin YA. Throttle 1/30min por tipo+org.
// Detecta el tipo desde el código de error de config (AI_POOL_EMPTY/AI_NO_CREDENTIAL) o el
// status/body de la respuesta del proveedor (402, 401/403, 429 insufficient_quota).
export async function alertAIResourceProblem(sb: any, opts: {
  organizationId: string | null | undefined;
  status?: number | null;
  errorCode?: string | null;     // AI_POOL_EMPTY | AI_NO_CREDENTIAL | AI_PLAN_NO_PLATFORM | insufficient_quota
  bodyText?: string | null;
  provider?: string | null;      // 'openai' | 'lovable'
  source?: string | null;        // 'platform' | 'own_key'
}): Promise<boolean> {
  try {
    if (!opts.organizationId) return false;
    const code = String(opts.errorCode || "");
    const status = Number(opts.status || 0);
    const body = String(opts.bodyText || "").toLowerCase();
    const isQuotaBody = /insufficient_quota|exceeded your current quota|billing|credit/i.test(body);

    // Clasificar el problema. Los 429 transitorios (rate limit puro) NO se alertan (son pasajeros).
    let kind: "sin_saldo" | "key_invalida" | null = null;
    if (code === "AI_POOL_EMPTY" || code === "AI_PLAN_NO_PLATFORM" || code === "insufficient_quota" || status === 402 || (status === 429 && isQuotaBody)) {
      kind = "sin_saldo";
    } else if (code === "AI_NO_CREDENTIAL" || status === 401 || status === 403) {
      kind = "key_invalida";
    }
    if (!kind) return false;

    const recipients = await orgAdminIds(sb, opts.organizationId);
    if (!recipients.length) return false;

    const throttleKey = `ai_resource:${kind}`;
    const { data: recent } = await sb.from("notifications")
      .select("id").eq("metadata->>throttle_key", throttleKey)
      .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString()).limit(1);
    if (recent && recent.length) return false;

    const ownKey = opts.source === "own_key" || opts.provider === "openai";
    const title = kind === "sin_saldo" ? "⛔ La IA se quedó SIN SALDO" : "⛔ Key de IA inválida";
    const message = kind === "sin_saldo"
      ? (ownKey
        ? "Tu cuenta de OpenAI quedó sin créditos — la IA NO está respondiendo a los clientes. Revisá platform.openai.com/billing y recargá."
        : "Se agotaron los créditos de IA — la IA NO está respondiendo a los clientes. Recargá en Integraciones → IA para reactivarla.")
      : "La key de IA es inválida o sin permiso — la IA NO puede responder a los clientes. Revisá la conexión en Integraciones → IA.";

    const rows = recipients.map((uid) => ({
      user_id: uid,
      type: "urgency",
      title,
      message,
      action_url: "/?tab=settings",
      metadata: { kind: "ai_resource", problem: kind, throttle_key: throttleKey, status: status || null, error_code: code || null, provider: opts.provider || null, source: opts.source || null },
    }));
    const { error } = await sb.from("notifications").insert(rows);
    if (error) { console.error("[alerts] alertAIResourceProblem insert failed", error.message); return false; }
    console.log("[alerts] ⛔ IA sin recursos:", kind, "→", recipients.length, "admins");
    return true;
  } catch (e) {
    console.error("[alerts] alertAIResourceProblem failed", e);
    return false;
  }
}
