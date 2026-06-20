# Ruteo de WhatsApp por conexión — arquitectura (fuente de verdad)

Cada conversación pertenece a **una** conexión, identificada por **una** de estas columnas en `webchat_conversations`:
`meta_connection_id` (Meta Cloud API) · `evolution_instance_id` (Evolution Go / QR) · `zernio_connection_id` (Zernio / WhatsApp oficial gestionado).

**Regla de oro:** nada de hardcodear un proveedor. Todo envío que tenga una **conversación** debe pasar por el **router central**.

---

## 1. Entrada (inbound) — un webhook por proveedor
Cada webhook matchea/crea la conversación con **su propia** columna de conexión. Nunca invade otra caja.

| Proveedor | Webhook | Matchea por |
|---|---|---|
| Evolution | `evolution-webhook` | `evolution_instance_id` |
| Meta | `meta-whatsapp-webhook` | `meta_connection_id` |
| Zernio | `zernio-webhook` | `zernio_connection_id` |

- Constraint `webchat_conv_open_phone_unique = (org, channel, telefono, **conexión**)`: el mismo contacto puede tener una conversación abierta **separada por conexión**.
- Los 3 responden 200 al instante y procesan en segundo plano (`EdgeRuntime.waitUntil`) para no timeoutear.

## 2. Salida reactiva — ROUTER CENTRAL
`_shared/whatsapp-router.ts` → `sendWhatsAppForConversation({ supabase, conversation, to, text, media })`.
Elige proveedor según la conexión de la conversación (prioridad **meta → evolution → zernio**) y llama a la función de envío correcta. Devuelve `{ ok, provider, error }`.

**DEBE usarse por todo flujo con conversación.** Usuarios actuales: ✅ `webchat-inbox` (envío manual del agente) · ✅ `ai-followup-cron` · ✅ `send-catalog-item` (Meta/Zernio; Evolution mantiene su camino especial webp/base64) · ✅ `agent-handoff-greeter`.

## 3. Salida proactiva (campañas / primer contacto) — `manual-outreach`
Recibe `connection_type` ('evolution' | 'meta_whatsapp' | 'zernio') + `instance_id` explícitos, porque fuera de la ventana de 24h **se requiere plantilla** y cada proveedor la maneja distinto (Meta: `template_id`; Zernio: `name`+`language`). Setea la columna de conexión correcta en la conversación y envía con la plantilla.

## 4. Respuesta del bot (inbound → IA)
Cada webhook invoca `webchat-bot` (que **solo devuelve chunks**, no envía) y despacha la respuesta por **su propio proveedor** (es la misma caja por la que entró). `zernio-webhook`→`zernio-send`, `meta-webhook`→`meta-whatsapp-send`, `evolution-webhook`→`evolution-send`. ✅ correcto por diseño.

## 5. Conversiones a Meta (CAPI) — `track-conversion`
Dispatcher: resuelve la conexión de la conversación → `zernio-conversion` (Zernio) o `meta-conversion` (Meta CAPI nativa). Disparado por el trigger configurable de etapas (`fn_lead_stage_conversion`).

---

## ⚠️ Pendiente de alinear al router (hoy hardcodeados a Evolution)
Estos flujos envían directo por `evolution-send` y **no respetan la conexión** (fallarían en Meta/Zernio). Migrar al router (o, si usan instancia configurada a nivel org, agregar `connection_type`):

- `booking-dispatcher` / `booking-reply-ai` — usan `settings.whatsapp_instance_id` (config de booking, Evolution). Requiere soportar connection_type en la config de booking.
- `post-sale-engine` / `process-post-sale-scheduled`
- `cakto-recovery-trigger`
- `webhook-receiver` (x2)
- `_shared/admin-send.ts`
- `start-whatsapp-conversation` (branch manual Meta/Evolution → router)

**Al tocar cualquiera de estos: cargar la conversación con sus columnas de conexión y usar `sendWhatsAppForConversation`.**
