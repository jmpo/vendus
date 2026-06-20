-- Permiso granular: habilita a un vendedor a crear/enviar Campañas Inteligentes
-- desde su propia pantalla. El alcance de leads se restringe a los asignados
-- del vendedor en el backend (campaign-preview / campaign-start).
ALTER TABLE public.user_permissions
  ADD COLUMN IF NOT EXISTS allow_campaigns boolean NOT NULL DEFAULT false;
