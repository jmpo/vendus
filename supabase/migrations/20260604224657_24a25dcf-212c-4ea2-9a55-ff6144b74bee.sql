
-- Trigger: ao criar um booking_event_type, semear 3 lembretes WhatsApp padrão se nenhum existir
CREATE OR REPLACE FUNCTION public.seed_default_booking_reminders()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só semeia para event types ativos e sem reminders pré-existentes
  IF EXISTS (SELECT 1 FROM public.booking_reminders WHERE event_type_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.booking_reminders
    (organization_id, event_type_id, offset_value, offset_unit, channel, message_template, is_active, order_index)
  VALUES
    (NEW.organization_id, NEW.id, 1, 'days', 'whatsapp',
     'Olá, {{nome_lead}}! 👋' || E'\n\n' ||
     'Passando para confirmar a *{{nome_evento}}* da *{{empresa}}*.' || E'\n\n' ||
     '📅 {{data}}' || E'\n' ||
     '⏰ {{hora}}' || E'\n' ||
     '📍 {{modalidade}}' || E'\n\n' ||
     'Posso confirmar essa agenda? Responda:' || E'\n' ||
     '1️⃣ Confirmar' || E'\n' ||
     '2️⃣ Reagendar' || E'\n' ||
     '3️⃣ Cancelar',
     true, 0),
    (NEW.organization_id, NEW.id, 30, 'minutes', 'whatsapp',
     'Oi, {{nome_lead}}! ⏰' || E'\n\n' ||
     'Faltam 30 minutos para nossa *{{nome_evento}}*.' || E'\n\n' ||
     '⏰ {{hora}}' || E'\n' ||
     '📍 {{modalidade}}' || E'\n\n' ||
     'Te espero! 🙌',
     true, 1),
    (NEW.organization_id, NEW.id, 5, 'minutes', 'whatsapp',
     '🔔 {{nome_lead}}, nossa reunião começa em 5 minutos!' || E'\n\n' ||
     '🔗 {{link_reuniao}}' || E'\n\n' ||
     'Te vejo já já 👋',
     true, 2);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_default_reminders ON public.booking_event_types;
CREATE TRIGGER trg_seed_default_reminders
AFTER INSERT ON public.booking_event_types
FOR EACH ROW EXECUTE FUNCTION public.seed_default_booking_reminders();
