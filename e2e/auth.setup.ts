import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join('e2e', '.auth', 'user.json');

// Inicia sesión una vez y guarda la sesión para los tests autenticados.
// Si no hay E2E_EMAIL/E2E_PASSWORD, se salta (los tests autenticados también se saltan).
setup('autenticar', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  setup.skip(!email || !password, 'Definí E2E_EMAIL y E2E_PASSWORD para correr los tests autenticados');

  await page.goto('/login');
  await page.locator('#email').fill(email!);
  await page.locator('#password').fill(password!);
  await page.locator('button[type="submit"]').first().click();

  // Esperá a salir del /login (redirige a la app)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/login/);

  await page.context().storageState({ path: authFile });
});
