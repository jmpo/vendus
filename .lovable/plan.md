## Objetivo

Pasar todo el sistema (UI, mensajes al cliente final, plantillas, contenido editorial) de portugués a español. **Un solo idioma**, sin librería de i18n.

## Principio rector

Traducir **strings visibles**, nunca **identificadores técnicos**. Toda la lógica de base de datos, nombres de funciones, columnas, enums y valores comparados por código se quedan exactamente como están.

---

## Qué SÍ se traduce

### 1. UI del frontend (`src/`)
Reemplazo directo de texto portugués → español en:
- Componentes `.tsx` en `src/components/**` y `src/pages/**`
- Toasts, mensajes de error, validaciones (Zod schemas)
- Labels de formularios, botones, tooltips, placeholders
- Sidebar, headers, menús móviles, onboarding
- Tablas/columnas visibles (headers de tablas, no nombres de DB)

### 2. Contenido editorial dentro del repo
- `src/docs/content/*` — documentación interna
- `src/components/docs/**` — Help Center estático
- Strings de release notes embebidos
- Textos del onboarding guiado

### 3. Mensajes que llegan al cliente final (edge functions)
- Plantillas React Email en `supabase/functions/_shared/transactional-email-templates/*`
- Strings hardcoded en edge functions que se envían por WhatsApp/email:
  - Confirmaciones de booking, recordatorios (`booking-dispatcher`)
  - Mensajes de cadencias default
  - Respuestas del bot fallback (cuando no hay agente IA)
  - Mensajes de "fora do horário", "agente indisponível", etc.

### 4. Datos semilla / contenido editable en DB
Vía migrations con `UPDATE` puntual (solo campos de texto visibles), nunca renombrando claves:
- `email_templates.subject` / `.body_html`
- `platform_email_templates` (auth, invites, notifications)
- `pipeline_stages.name` cuando son los defaults del seed
- `cadence_templates` y `cadences` default
- `quick_replies` default
- `tag_automations` nombres visibles
- `help_articles` y `help_categories` (si están seedeados)
- `platform_releases` ya publicados (opcional)
- `product_agents.system_prompt` / persona / instructions defaults
- `booking_event_types` defaults
- `auto_notification_settings` mensajes default

> Importante: solo se traducen los registros que vinieron como **seed inicial**. Datos creados por usuarios reales no se tocan — cada organización los reescribe a su gusto.

---

## Qué NO se toca jamás

| Categoría | Ejemplos | Por qué |
|---|---|---|
| Nombres de funciones SQL | `aplicar_etiqueta`, `criar_deal`, `agendar_followup` | Edge functions y triggers los invocan por nombre |
| Nombres de tablas/columnas | `leads`, `capture_funnels`, `sales_squads` | Todo el código TypeScript y los tipos generados rompen |
| Valores de enums | `'aguardando'`, `'em_atendimento'`, `'fechado_ganho'` | El código compara strings exactos en condicionales |
| Claves de tools de IA | `criar_deal`, `aplicar_etiqueta` en `_shared/tools/impl/*` | El LLM las llama por nombre y están registradas en prompts |
| Slugs, identificadores, IDs | `slug` de funnels/forms ya creados | URLs públicas existentes romperían |
| Strings en `RAISE EXCEPTION` de funciones DB | Mensajes de error de RPCs | Se traducen del lado del frontend al mostrarlos (mapeo) |
| Memorias del proyecto (`mem://`) | Documentación interna en PT | Son notas históricas; nuevas se escriben en ES |

---

## Plan de ejecución por fases

Cada fase es una tanda de cambios revisable por separado.

### Fase 1 — UI core (impacto visible inmediato)
- Sidebar, Header, MobileHeader, MobileBottomNav, NotificationCenter
- Dashboard, ProductDashboard, login/auth pages
- Toasts globales y mensajes de error genéricos

### Fase 2 — Módulos principales
- Leads (lista, detalle, kanban, notas, tareas)
- Atendimento/Inbox (chat, accept bar, transferencias)
- Agendamentos (calendario, booking, event types)
- Vendas (deals, comissões, metas)

### Fase 3 — Captura, IA y automação
- Funis de captura, Forms builder, Quiz
- Agentes IA (configuração, Brain, training)
- Cadências, Campanhas, Webhooks

### Fase 4 — Admin y Super Admin
- Configurações de empresa, equipe, setores
- Painel Super Admin (planos, organizações, AI keys, billing)
- Integrações (Hotmart, Cakto, Meta WA, Instagram, Sankhya, etc.)

### Fase 5 — Conteúdo ao cliente final (mais sensível)
- Plantillas de email transacional (`_shared/transactional-email-templates`)
- Mensagens hardcoded em edge functions (booking, cadências, fallback bot)
- Update de seeds em `email_templates`, `platform_email_templates`
- Update de prompts default de `product_agents` (persona consultiva em ES, sem alterar estrutura SPIN)

### Fase 6 — Conteúdo editorial
- Help Center (`help_articles`, `help_categories` seedeados)
- Docs internos (`src/docs/content/*`)
- Onboarding guiado, release notes

### Fase 7 — Localização técnica
- `date-fns`: trocar locale `ptBR` por `es` em todos os formatters
- `Intl.NumberFormat`: trocar `pt-BR` por `es` (ou `es-AR`/`es-MX` — confirmar país preferido)
- Moeda default: hoje BRL — definir se mantém ou troca (depende do mercado-alvo)
- Atributo `<html lang="pt-BR">` em `index.html` → `lang="es"`
- Meta tags SEO, manifest.json

---

## Decisões técnicas

```text
┌─────────────────────────────────────────────────────┐
│ Capa                  │ Acción            │ Riesgo  │
├─────────────────────────────────────────────────────┤
│ Componentes React     │ Replace strings   │ Bajo    │
│ Edge function strings │ Replace strings   │ Bajo    │
│ Email templates       │ Replace strings   │ Bajo    │
│ DB: seeds editáveis   │ UPDATE puntual    │ Médio   │
│ DB: enums, nombres    │ NO TOCAR          │ —       │
│ DB: funções SQL       │ NO TOCAR          │ —       │
│ Memórias mem://       │ Manter PT         │ —       │
└─────────────────────────────────────────────────────┘
```

### Sobre la moneda y locale regional
Hoy el sistema asume Brasil (DDI 55 obligatorio en teléfonos, BRL en precios, `pt-BR` en formatters). Para una traducción completa hace falta confirmar:
- ¿Sigue siendo mercado brasileño solo idioma cambia? → mantengo BRL + DDI 55, solo cambio textos.
- ¿Cambia a mercado hispano? → necesito saber país para DDI y moneda; la regla "DDI 55" en memoria es **bloqueante** y debe revisarse.

---

## Entregables al final

- Toda la UI en español.
- Mensajes al cliente final (email/WhatsApp default) en español.
- Documentación interna y Help Center en español.
- Base de datos intacta en estructura, con seeds traducidos.
- Memoria del proyecto actualizada notando "plataforma en español; identificadores DB permanecen en PT por compatibilidad".

## Pregunta abierta antes de empezar

Necesito que confirmes el **mercado/país objetivo** porque hay constantes regionales (DDI 55, moneda BRL, locale `pt-BR`) que no son solo idioma. Si me dices el país, ajusto la Fase 7 en este mismo plan.
