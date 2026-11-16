// Capturas para o PR (não é teste de regressão): CAPTURAS=pasta npx playwright test capturas --project=desktop
import { test } from '@playwright/test';

const PASTA = process.env.CAPTURAS;
const TAMANHOS = [
  { nome: '360x740', width: 360, height: 740 },
  { nome: '390x844', width: 390, height: 844 },
  { nome: 'desktop', width: 1440, height: 900 },
];

test.skip(!PASTA, 'só roda com CAPTURAS=<pasta>');

for (const t of TAMANHOS) {
  test(`busca por rota ${t.nome}`, async ({ page }) => {
    await page.setViewportSize({ width: t.width, height: t.height });
    await page.goto('/#rota');
    await page.getByRole('combobox', { name: 'País de destino' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('#pais-para-campo').disabled);
    await page.waitForTimeout(500);
    const grupo = page.locator('fieldset', { has: page.getByRole('combobox', { name: 'País de destino' }) });
    // o topo (logo, "Meus voos") é fixo: deixa uma folga para ele não cobrir o campo
    await grupo.evaluate(el => { el.scrollIntoView({ block: 'start' }); scrollBy(0, -140); document.querySelector('.painel, main')?.scrollBy?.(0, -140); });
    await page.screenshot({ path: `${PASTA}/${t.nome}-inicio.png` });
    const busca = page.getByRole('combobox', { name: /aeroporto de destino/i });
    if (await busca.count()) {
      await page.getByRole('combobox', { name: 'País de destino' }).fill('bras');
      await page.keyboard.press('Enter');
      await busca.fill('salv');
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${PASTA}/${t.nome}-digitando.png` });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${PASTA}/${t.nome}-escolhido.png` });
    }
  });
}
