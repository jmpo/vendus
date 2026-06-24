# Tests E2E (Playwright)

Tests de aceptación automatizados — para verificar los flujos sin probar a mano.

## Setup (una sola vez)

```bash
npm run test:e2e:install   # descarga el navegador (Chromium)
```

## Correr los tests

```bash
npm run test:e2e           # corre todo (headless). Arranca el dev server solo si no está corriendo.
npm run test:e2e:ui        # modo interactivo (ver paso a paso)
npm run test:e2e:report    # abre el último reporte HTML
```

## Variables de entorno (opcionales)

| Variable | Para qué | Default |
|---|---|---|
| `E2E_BASE_URL` | URL de la app | `http://localhost:8080` |
| `E2E_QUIZ_SLUG` | Slug del quiz público a probar | `descubre-tu-peugeot-ideal` |
| `E2E_EMAIL` / `E2E_PASSWORD` | Credenciales para los tests autenticados | (si faltan, se saltan) |

Ejemplo (PowerShell):
```powershell
$env:E2E_EMAIL="vendedor@tuempresa.com"; $env:E2E_PASSWORD="..."; npm run test:e2e
```

## Qué cubre

- **`quiz.public.spec.ts`** — recorre el quiz público de punta a punta en modo `?preview=1`
  (NO crea leads ni toca métricas → repetible). Verifica que el quiz cargue y llegue a la pantalla final.
- **`app.auth.spec.ts`** — smoke autenticado: la app carga sin redirigir a login (solo si hay credenciales).
- **`auth.setup.ts`** — inicia sesión una vez y reusa la sesión.

## Agregar más tests

- Públicos (sin login): `nombre.public.spec.ts`
- Autenticados (reusan sesión): `nombre.auth.spec.ts`

Usá `data-testid` para selectores estables (ej: el quiz ya tiene `quiz-cta`, `quiz-option`, `quiz-input`, `quiz-complete`).
