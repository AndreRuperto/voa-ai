import { test, expect } from '@playwright/test';

test.describe('busca por rota', () => {
  test('"Para" abre sem país, igual ao "De"', async ({ page }) => {
    await page.goto('/#rota');
    const de = page.getByRole('combobox', { name: 'País de origem' });
    const para = page.getByRole('combobox', { name: 'País de destino' });
    await expect(de).toBeEnabled();
    await expect(para).toBeEnabled();
    await expect(de).toHaveValue('');
    await expect(para).toHaveValue('');
    await expect(para).toHaveAttribute('placeholder', 'Escolha ou digite o país');
    await expect(page.locator('#aero-para input')).toHaveCount(0);
  });
});
