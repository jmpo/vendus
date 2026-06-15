/**
 * Traduce mensajes de error de Supabase Auth y PostgREST a español.
 * Acepta Error, string u objeto con .message.
 */
export function translateAuthError(input: unknown): string {
  const raw =
    typeof input === 'string'
      ? input
      : (input as any)?.message || (input as any)?.error_description || '';

  if (!raw) return 'Ocurrió un error inesperado. Intentá de nuevo.';

  const msg = String(raw);
  const lower = msg.toLowerCase();

  // Auth
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'Este email ya tiene una cuenta. Iniciá sesión para continuar.';
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
    return 'Email o contraseña incorrectos.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Confirmá tu email antes de iniciar sesión.';
  }
  if (lower.includes('email rate limit') || lower.includes('rate limit')) {
    return 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.';
  }
  if (lower.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (
    lower.includes('new password should be different') ||
    lower.includes('same_password')
  ) {
    return 'La nueva contraseña debe ser distinta de la actual.';
  }
  if (lower.includes('new email should be different') || lower.includes('same_email')) {
    return 'El nuevo email debe ser distinto del actual.';
  }
  if (lower.includes('pwned') || lower.includes('exposed in') || lower.includes('data breach')) {
    return 'Esta contraseña fue expuesta en filtraciones. Elegí otra.';
  }
  if (lower.includes('weak password') || lower.includes('password is too weak')) {
    return 'Contraseña muy débil. Usá letras, números y símbolos.';
  }
  if (lower.includes('unable to validate email') || lower.includes('email_address_invalid')) {
    return 'Email inválido. Verificalo e intentá de nuevo.';
  }
  if (lower.includes('signup is disabled') || lower.includes('signups not allowed') || lower.includes('signup_disabled')) {
    return 'Los registros están deshabilitados por el momento.';
  }
  if (lower.includes('user not found')) {
    return 'Usuario no encontrado.';
  }
  if (lower.includes('email_exists') || lower.includes('phone_exists')) {
    return 'Este contacto ya está registrado.';
  }
  if (lower.includes('otp_expired') || lower.includes('token has expired') || lower.includes('expired')) {
    return 'El código o enlace expiró. Solicitá uno nuevo.';
  }
  if (lower.includes('session_not_found') || lower.includes('auth session missing')) {
    return 'Sesión expirada. Iniciá sesión de nuevo.';
  }
  if (
    lower.includes('for security purposes, you can only request this after') ||
    lower.includes('over_email_send_rate_limit')
  ) {
    return 'Por seguridad, esperá unos segundos antes de volver a intentar.';
  }
  if (lower.includes('over_request_rate_limit')) {
    return 'Demasiadas solicitudes. Esperá un instante e intentá de nuevo.';
  }
  if (lower.includes('captcha')) {
    return 'Falló la verificación de seguridad. Recargá la página.';
  }

  // Invitaciones
  if (lower.includes('convite inválido') || lower.includes('invitation not found') || lower.includes('invitación')) {
    return 'Invitación inválida o expirada.';
  }

  // PostgREST / Postgres
  if (lower.includes('user_roles_user_id_fkey') || lower.includes('foreign key constraint')) {
    return 'No se pudo completar la operación. Recargá la página e intentá de nuevo.';
  }
  if (lower.includes('duplicate key') || lower.includes('unique constraint')) {
    return 'Este registro ya existe.';
  }
  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'No tenés permiso para esta acción.';
  }
  if (lower.includes('violates not-null') || lower.includes('null value in column')) {
    return 'Completá todos los campos obligatorios.';
  }
  if (lower.includes('invalid input syntax for type uuid')) {
    return 'Identificador inválido. Recargá la página.';
  }

  // Red
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Fallo de conexión. Verificá tu internet.';
  }

  // Fallback: si quedó texto probablemente en inglés (sin acentos),
  // devuelve mensaje genérico en español en lugar del texto crudo.
  const looksEnglish = /^[\x20-\x7E]*$/.test(msg) && !/[áéíóúñü¿¡]/i.test(msg);
  if (looksEnglish) {
    return 'No se pudo completar la acción. Intentá de nuevo.';
  }

  return msg;
}
