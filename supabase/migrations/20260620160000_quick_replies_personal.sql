-- Respuestas rápidas personales por vendedor.
-- Cada vendedor puede crear las suyas (is_personal=true, created_by=él) además de las
-- compartidas del equipo (is_personal=false, creadas por el admin). El RLS ya permite
-- a cualquier miembro de la org insertar/ver; el scoping personal se hace por consulta.
ALTER TABLE public.quick_replies
  ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quick_replies.is_personal IS 'true = respuesta personal del vendedor (created_by); false = compartida del equipo (admin)';
