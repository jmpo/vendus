-- CRM WhatsApp-first: el email NO es obligatorio para agendar. El teléfono de
-- WhatsApp es el contacto principal y la confirmación va por WhatsApp. Hacemos
-- guest_email nullable para permitir reservas sin correo (el agente lo pide solo
-- de forma opcional). Aditiva, sin pérdida de datos.
ALTER TABLE public.booking_requests ALTER COLUMN guest_email DROP NOT NULL;
