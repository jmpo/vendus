-- Marca la primera plantilla aprobada por organización, para la notificación de felicitación.
-- La maneja zernio-webhook al recibir whatsapp.template.status_updated (status APPROVED).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS first_template_approved_at timestamptz;
