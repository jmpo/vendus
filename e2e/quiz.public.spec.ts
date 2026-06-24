import { test, expect } from '@playwright/test';

// Slug del quiz público a probar. Override: E2E_QUIZ_SLUG=mi-slug npm run test:e2e
const SLUG = process.env.E2E_QUIZ_SLUG || 'descubre-tu-peugeot-ideal';

test.describe('Quiz público (Captación)', () => {
  test('se completa de punta a punta en modo preview (sin crear lead)', async ({ page }) => {
    test.setTimeout(90_000); // tolera el arranque en frío de Vite (primera compilación)
    // ?preview=1 → recorre toda la UI pero NO guarda lead ni incrementa métricas → repetible
    await page.goto(`/q/${SLUG}?preview=1`, { waitUntil: 'domcontentloaded' });

    // El quiz cargó (si el slug es incorrecto, fallará acá con un mensaje claro)
    await expect(page.getByTestId('quiz-cta').or(page.getByTestId('quiz-complete'))).toBeVisible({ timeout: 45_000 });
    await expect(
      page.getByText('Quiz no encontrado'),
      `El quiz "${SLUG}" no se encontró. Configurá E2E_QUIZ_SLUG con el slug correcto.`,
    ).toBeHidden();

    // Recorre cada paso (texto / opciones / input) hasta la pantalla de cierre
    for (let step = 0; step < 25; step++) {
      if (await page.getByTestId('quiz-complete').isVisible().catch(() => false)) break;

      const input = page.getByTestId('quiz-input');
      if (await input.isVisible().catch(() => false)) {
        await input.fill('Test E2E');
      } else {
        const option = page.getByTestId('quiz-option').first();
        if (await option.isVisible().catch(() => false)) await option.click();
      }

      const cta = page.getByTestId('quiz-cta');
      const ctaReady = (await cta.isVisible().catch(() => false)) && (await cta.isEnabled().catch(() => false));
      if (ctaReady) {
        await cta.click();
        await page.waitForTimeout(350); // transición entre pasos
      } else {
        break;
      }
    }

    // Llegó a la pantalla final (gracias / resultado)
    await expect(page.getByTestId('quiz-complete')).toBeVisible({ timeout: 10_000 });
  });
});
