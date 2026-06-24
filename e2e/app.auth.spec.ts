import { test, expect } from '@playwright/test';

// Smoke tests autenticados. Se saltan si no hay credenciales (E2E_EMAIL/E2E_PASSWORD).
test.describe('App autenticada (smoke)', () => {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Definí E2E_EMAIL y E2E_PASSWORD');

  test('la app carga sin redirigir a login', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/login/);
    // La sesión persistió: hay contenido de la app renderizado
    await expect(page.locator('#root')).not.toBeEmpty();
  });

  test('el panel admin es accesible (o redirige según el rol, sin crashear)', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/login/);
    // No quedó en pantalla de error en blanco
    await expect(page.locator('#root')).not.toBeEmpty();
  });
});
