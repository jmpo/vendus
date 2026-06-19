# Proceso de actualizaciones — Vendus CRM

> Objetivo: meter mejoras nuevas **sin romper lo que ya funciona**.
> Regla de oro: nunca trabajar sobre cambios sin commitear. Primero se guarda lo bueno, después se prueba lo nuevo en una rama aparte.

---

## 0. Antes de empezar (baseline)

- [ ] `git status` debe estar **limpio** (todo commiteado). Si hay pendientes, commitearlos o descartarlos primero.
- [ ] Crear una rama para el update: `git checkout -b update/<descripcion-corta>`. **Nunca** trabajar el update directo en `main`.

## 1. Cómo se entrega un update

El que trae la mejora debe pasar:

1. **Solo el delta** (los archivos nuevos/cambiados) — **NO** el proyecto base de Lovable.
   La comparación se hace contra el repo actual, no contra un snapshot viejo.
2. **Un changelog corto** con la *intención* de cada cambio (qué hace), no solo los archivos.
   Ej: "agregué follow-up por agente", "nuevo reporte de atención X".
3. Config/secrets (env, tokens) **aparte** y por separado, nunca dentro del código.

## 2. Reglas para no romper nada

1. **Merge selectivo, archivo por archivo.** Traer la lógica nueva; preservar branding y trabajo propio.
2. **Migraciones SOLO aditivas/idempotentes**: `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`.
   Nunca `DROP` ni nada destructivo.
3. **NUNCA `supabase db push`** — el historial de migraciones remoto está vacío, intentaría aplicar todo y rompe.
   El SQL nuevo se aplica de forma puntual y controlada.
4. **Tras cualquier cambio de DB → regenerar types**:
   `supabase gen types typescript --linked --schema public > src/integrations/supabase/types.ts`
   (Si no, `types.ts` queda viejo y aparecen bugs raros — ya pasó con `ig_sender_id`.)
5. **Lista "NO SOBRESCRIBIR"** (funciones propias que el delta de Lovable no tiene):
   - `supabase/functions/evolution-webhook` → tiene `EdgeRuntime.waitUntil` (procesamiento en background)
   - `supabase/functions/webchat-bot` → orquestador, booking, escalamiento a humano
   - `supabase/functions/evolution-proxy` → fix de QR + auto-reparación de instancias
   - `supabase/functions/evolution-send` → timeout anti-cuelgue
   - crons propios (`human-handback-cron`, `webhook-keepalive`, `ai-followup-cron`)
   Si el delta toca alguno: **merge selectivo**, nunca reemplazo directo.

## 3. Validación (antes de mergear)

- [ ] `npx tsc --noEmit` sin errores nuevos
- [ ] `npm run build` (Vite) pasa
- [ ] Deploy de las edge functions tocadas: `supabase functions deploy <nombre> --project-ref jtdvnyqxhsrtqpamtepz`
- [ ] Correr el **CHECKLIST_REGRESION.md** completo
- [ ] Branding intacto (Vendus, colores, logo, todo en español — sin portugués)

## 4. Salida

- [ ] PR de la rama `update/...` → revisar → merge a `main`
- [ ] Commit → Vercel deploya el frontend automáticamente
- [ ] Edge functions ya desplegadas en el paso 3

---

## Datos del entorno

- Supabase project ref: `jtdvnyqxhsrtqpamtepz`
- Frontend: Vercel (deploya al commitear a `main`)
- Backend: Supabase Edge Functions (se despliegan con el CLI, no con Vercel)
- WhatsApp: Evolution Go (servidor en EasyPanel)
