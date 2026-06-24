import { defineConfig, devices } from '@playwright/test';

// Config E2E autónoma (sin dependencia de Lovable). Tests en ./e2e
// Variables opcionales:
//   E2E_BASE_URL    (default http://localhost:8080)
//   E2E_QUIZ_SLUG   (slug del quiz público a probar; default descubre-tu-peugeot-ideal)
//   E2E_EMAIL / E2E_PASSWORD  (credenciales para los tests autenticados; si faltan, se saltan)
// Puerto dedicado para los tests (evita chocar con otros servers en :8080)
const PORT = process.env.E2E_PORT || '5180';
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // 1) Login una vez y guarda la sesión (solo si hay credenciales)
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    // 2) Flujos públicos (sin login)
    {
      name: 'public',
      testMatch: /.*\.public\.spec\.ts/,
      // Usa el Chrome del sistema (no requiere descargar Chromium). Para usar el
      // Chromium de Playwright en su lugar: borrá `channel` y corré test:e2e:install.
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    // 3) Flujos autenticados (reusan la sesión del setup)
    {
      name: 'authenticated',
      testMatch: /.*\.auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome', storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  // Arranca Vite en un puerto dedicado para los tests (no reusa otros servers)
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
