# Vendus — CRM + WhatsApp SaaS (contexto del proyecto)

> Producto **existente y en producción**, NO un proyecto nuevo. Es un CRM white-label
> con IA sobre WhatsApp (marca de referencia: "MP AGENCIA" / producto demo "BarberPro").
> El usuario es técnico: **mostrá comandos, paths y decisiones**. No "fábrica de apps".

## Stack REAL (esto NO es Next.js)

- **Build**: Vite 5 (SPA client-side) — `npm run dev` = `vite`. NO hay SSR, RSC, ni App Router.
- **UI**: React 18 + shadcn/ui + Tailwind 3. Ruteo: **react-router-dom 6** (no file-based).
- **Datos**: TanStack React Query 5 + cliente Supabase. Forms: react-hook-form + Zod.
- **Backend**: **Supabase** — Postgres + RLS + Realtime + Storage + **Edge Functions en Deno**.
  El "backend/API" son Edge Functions (`supabase/functions/*`), NO rutas de Next ni `/api`.
- **Package manager**: Bun (`bun.lockb`). **Deploy**: frontend en Vercel desde `main`; backend = Supabase.

## Canal e IA

- **WhatsApp = Zernio únicamente.** Evolution / Instagram / Meta directo fueron ELIMINADOS.
  Envío: `zernio-send`. Entrada: `zernio-webhook`. Router compartido: `_shared/whatsapp-router.ts`.
- **IA = clave propia de OpenAI** (org_ai_routing → provider `openai`, gpt-4o-mini). El gateway
  "lovable" en `_shared/ai-router.ts` es solo fallback multi-tenant; MP AGENCIA NO lo usa.

## Convenciones y trampas (aprendidas a los golpes)

- **SIEMPRE pinear** `@supabase/supabase-js@2.90.1` en Edge Functions. Un `@2` sin versión rompe
  `functions.invoke` al redesplegar (rompió el envío de fotos una vez).
- **Patrón `tmpq`** para correr SQL/scripts contra la base: crear `supabase/functions/tmpq/index.ts`
  (usa `npm:postgres@3.4.4` con `SUPABASE_DB_URL`, o supabase-js con service key) → deploy
  `--no-verify-jwt` → invocar por HTTP → borrar. Los webhooks públicos se despliegan `--no-verify-jwt`.
- **NO existe el join `profiles!inner` sobre `user_roles`** → resolver admins en 2 pasos
  (`orgAdminIds` en `_shared/alerts.ts`). Un `profiles!inner(...)` devuelve `[]` en silencio.
- **Zernio reenvía webhooks** ("al menos una vez") → dedup por wamid. Hay índice único
  `(conversation_id, metadata->>'zernio_message_id')` + guard en `zernio-webhook`.
- **Plan Free**: techo de **100 Edge Functions** (se toca seguido) y 5 GB egress. Antes de
  desplegar algo nuevo puede requerir borrar una función.
- En `webchat-bot`, cuidado con variables block-scoped referenciadas al final (tiran ReferenceError
  silenciado por catch). Verificar siempre con un test real.

## Skills de saas-factory (`.claude/skills/`)

Están disponibles y son útiles (add-login, add-payments, add-emails, ai/agents, design-systems),
**pero están escritos para Next.js**. Al usarlos, TRADUCIR al stack de acá:

| Skill dice (Next.js) | Acá se hace con |
|---|---|
| API route / route handler / server action | **Edge Function de Supabase (Deno)** |
| App Router / `app/`, `page.tsx`, `layout.tsx` | rutas en **react-router-dom** + `src/pages/` |
| Server Component / data fetching en server | **React Query + cliente Supabase** (browser) |
| `next-auth` | **Supabase Auth** (ya integrado) |
| Polar (pagos del skill) | los gateways del proyecto (Hotmart / etc.) |

Lo agnóstico (componentes React, TS, Tailwind, shadcn, Zod, patrones de UI, design-systems) se
aplica tal cual.

## Estructura del código

- `src/components/`, `src/hooks/`, `src/pages/`, `src/lib/`, `src/integrations/supabase/client.ts`
  (el cliente Supabase REAL — no usar scaffolds tipo `src/lib/supabase/`).
- `supabase/functions/` = Edge Functions. `supabase/functions/_shared/` = helpers compartidos.
- `supabase/migrations/` = esquema.
