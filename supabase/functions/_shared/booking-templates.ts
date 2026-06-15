// Shared helpers for the Booking automation engine.
// Render message templates and build standard variable maps from a booking row.

export type BookingVars = Record<string, string>;

/**
 * Replace {{variable}} placeholders in the template with values from the map.
 * Unknown variables are left empty (not echoed) to avoid leaking placeholders.
 */
export function renderTemplate(template: string | null | undefined, vars: BookingVars): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Format a Date in the booking timezone (es-PY).
 */
function fmtDate(date: Date, timezone: string): string {
  return date.toLocaleDateString("es-PY", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: timezone,
  });
}

function fmtTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString("es-PY", {
    hour: "2-digit", minute: "2-digit", timeZone: timezone,
  });
}

/**
 * Build the standard variable map used in confirmation/reminder/recovery messages.
 */
export function buildBookingVars(input: {
  guest_name: string;
  guest_email: string;
  guest_phone?: string | null;
  start_time: string;
  end_time: string;
  timezone?: string | null;
  event_name?: string | null;
  host_name?: string | null;
  meet_link?: string | null;
  modalidade?: string | null;
  empresa?: string | null;
  confirmation_url?: string | null;
  reschedule_url?: string | null;
}): BookingVars {
  const tz = input.timezone || "America/Asuncion";
  const start = new Date(input.start_time);
  const end = new Date(input.end_time);
  return {
    nome_lead: input.guest_name || "",
    email_lead: input.guest_email || "",
    telefone_lead: input.guest_phone || "",
    nome_evento: input.event_name || "Reunión",
    nome_anfitriao: input.host_name || "",
    nome_vendedor: input.host_name || "",
    empresa: input.empresa || "",
    modalidade: input.modalidade || "Online",
    data: fmtDate(start, tz),
    hora: fmtTime(start, tz),
    hora_fim: fmtTime(end, tz),
    link_reuniao: input.meet_link || "",
    link_confirmar: input.confirmation_url || "",
    link_reagendar: input.reschedule_url || "",
  };
}

/**
 * Default templates used when the org didn't customize anything.
 */
export const DEFAULT_TEMPLATES = {
  confirmation_whatsapp:
    "¡Hola, {{nome_lead}}! 👋\n\nPaso para confirmar la *{{nome_evento}}* de *{{empresa}}*.\n\n📅 {{data}}\n⏰ {{hora}}\n📍 {{modalidade}}\n\n¿Puedo confirmar esta agenda? Respondé:\n1️⃣ Confirmar\n2️⃣ Reagendar\n3️⃣ Cancelar",
  confirmation_email_subject:
    "Confirmación: {{nome_evento}} — {{data}} a las {{hora}}",
  reminder_whatsapp:
    "¡Hola, {{nome_lead}}! ⏰\n\nRecordatorio: tenemos *{{nome_evento}}* hoy a las *{{hora}}*. ¡Te espero! 🙌",
  reminder_link_whatsapp:
    "🔔 {{nome_lead}}, ¡nuestra reunión empieza en unos minutos!\n\n🔗 {{link_reuniao}}\n\nNos vemos ya 👋",
  recovery_whatsapp:
    "Hola, {{nome_lead}}, te extrañamos en la reunión de hoy. ¿Querés reagendar? Respondé este mensaje y te ayudamos.",
  internal_whatsapp:
    "📅 Nueva reserva: {{nome_lead}} — {{nome_evento}} el {{data}} a las {{hora}}.",
} as const;
