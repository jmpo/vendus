-- Fix: get_or_create_meta_master_key fallaba con "gen_random_bytes does not exist"
-- porque pgcrypto vive en el schema `extensions` y la función tenía search_path = public.
-- Esto rompía el cifrado de credenciales (Meta y Zernio). Qualificamos la llamada
-- y ampliamos el search_path. Idempotente (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION public.get_or_create_meta_master_key()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  k text;
  settings_id uuid;
BEGIN
  SELECT id, meta_wa_master_key INTO settings_id, k FROM public.platform_settings LIMIT 1;
  IF settings_id IS NULL THEN
    INSERT INTO public.platform_settings DEFAULT VALUES RETURNING id INTO settings_id;
  END IF;
  IF k IS NULL OR length(k) = 0 THEN
    k := encode(extensions.gen_random_bytes(32), 'base64');
    UPDATE public.platform_settings SET meta_wa_master_key = k WHERE id = settings_id;
  END IF;
  RETURN k;
END;
$function$;
