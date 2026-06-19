# Checklist de regresión — flujos que SIEMPRE deben funcionar

> Correr esta lista después de cada actualización, antes de dar por bueno el cambio.
> Si algo de acá falla, el update rompió algo: no mergear hasta arreglarlo.

## 🟢 WhatsApp / Conexión
- [ ] **Conectar WhatsApp (QR)**: crear/conectar una instancia → el QR aparece en el panel (no se queda "Esperando QR").
- [ ] **Recibir mensaje entrante**: mandar un WhatsApp al número conectado → la conversación aparece en el inbox.
- [ ] **Enviar mensaje desde el inbox**: escribir y enviar → llega al cliente (no "Error al enviar").
- [ ] **Enviar multimedia** (imagen/audio/documento) → se entrega.
- [ ] **Contacto compartido (vCard)** → se ve la tarjeta, no un mensaje vacío.

## 🤖 IA / Atención
- [ ] **La IA responde** a un mensaje nuevo (orquestador → agente correcto).
- [ ] **Escalamiento a humano**: cliente pide humano / se muestra ofuscado → pasa a "En Fila" + etiqueta "Requiere humano" + aviso.
- [ ] **Handoff entre marcas/agentes** mantiene contexto.
- [ ] **Follow-up de agentes**: tras silencio del cliente, se encola y se envía; si el cliente responde, se cancela.

## 📅 Agendamiento
- [ ] Agendar el día que el cliente pide (formato 24h).
- [ ] Reagendar (cancela el anterior + crea el nuevo).
- [ ] Recordar cita existente (no agenda doble).
- [ ] No ofrece días/horarios cerrados (respeta disponibilidad).

## 📥 Inbox
- [ ] Pestañas Atendiendo / Agentes / En Fila muestran las conversaciones correctas.
- [ ] Los **contadores** de las pestañas se actualizan al instante al mover una conversación.
- [ ] Filtro por producto funciona.

## 🎨 Branding / Idioma
- [ ] Logo y nombre "Vendus", colores y `--primary` intactos.
- [ ] Todo en **español** (sin portugués residual en UI, toasts ni mensajes de sistema).

## ⚙️ Técnico
- [ ] `npx tsc --noEmit` sin errores.
- [ ] `npm run build` pasa.
- [ ] Edge functions tocadas desplegadas.
- [ ] Si hubo cambio de DB: migración aditiva aplicada + `types.ts` regenerado.
- [ ] Crons activos (ai-followup-cron, webhook-keepalive, human-handback-cron).
