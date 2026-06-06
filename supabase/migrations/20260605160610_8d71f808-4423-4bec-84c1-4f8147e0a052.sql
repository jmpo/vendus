DO $$
DECLARE v_event_id uuid;
BEGIN
  INSERT INTO public.calendar_events (
    title, start_time, end_time, timezone,
    user_id, organization_id, event_type, status,
    description, location, create_meet, color, attendees, metadata
  ) VALUES (
    'Apresentação Vendus - Carmo Pereira',
    '2026-06-08 13:00:00+00',
    '2026-06-08 13:30:00+00',
    'America/Sao_Paulo',
    '5fa86a85-64cc-4d94-bb2c-cc6908462a60',
    'fb0f9cb1-8535-4e79-8120-1b96ab72450a',
    'booking', 'confirmed',
    E'Agendado via chat AI (recuperação manual)\nCliente: Carmo Pereira\nEmail: diretoria@andeserp.com.br',
    'google_meet', true, '#3b82f6',
    '[{"email":"diretoria@andeserp.com.br","name":"Carmo Pereira"}]'::jsonb,
    jsonb_build_object(
      'booking_event_type_id','0093f8c7-d4be-4a41-9405-eea67bbb2d81',
      'guest_name','Carmo Pereira',
      'guest_email','diretoria@andeserp.com.br',
      'source','manual-recovery'
    )
  ) RETURNING id INTO v_event_id;

  ALTER TABLE public.booking_requests DISABLE TRIGGER trg_protect_booking_public_updates;
  UPDATE public.booking_requests SET calendar_event_id = v_event_id
   WHERE id = 'bbd03768-96ed-44ac-8578-8a67fdb96abe';
  ALTER TABLE public.booking_requests ENABLE TRIGGER trg_protect_booking_public_updates;
END$$;