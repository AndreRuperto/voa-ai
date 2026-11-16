// Capturas da lista de países aberta (não é teste de regressão):
// CAPTURAS=pasta npx playwright test capturas-rolagem --project=desktop
import { test } from '@playwright/test';

const PASTA = process.env.CAPTURAS;
test.skip(!PASTA, 'só roda com CAPTURAS=<pasta>');

for (const t of [{ nome: '360x740', width: 360, height: 740 }, { nome: '390x844', width: 390, height: 844 }, { nome: 'desktop', width: 1440, height: 900 }]) {
  test(`lista de países ${t.nome}`, async ({ page }) => {
    await page.setViewportSize({ width: t.width, height: t.height });
    await page.goto('/#rota');
    const campo = page.getByRole('combobox', { name: 'País de origem' });
    await page.waitForFunction(() => !document.querySelector('#pais-de-campo').disabled);
    await campo.fill('bra');
    await campo.press('Enter');
    await campo.click();
    const lista = page.getByRole('listbox', { name: 'País de origem' });
    await lista.waitFor();
    await page.waitForTimeout(300);
    const caixa = await lista.boundingBox();
    const pad = 16;
    await page.screenshot({ path: `${PASTA}/${t.nome}-lista.png`,
      clip: { x: Math.max(0, caixa.x - pad), y: Math.max(0, caixa.y - 90), width: Math.min(t.width, caixa.width + pad * 2), height: caixa.height + 90 + pad } });
    // hover na barra, para ver o estado realçado
    await page.mouse.move(caixa.x + caixa.width - 6, caixa.y + 40);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${PASTA}/${t.nome}-lista-hover.png`,
      clip: { x: Math.max(0, caixa.x - pad), y: Math.max(0, caixa.y - 90), width: Math.min(t.width, caixa.width + pad * 2), height: caixa.height + 90 + pad } });
  });
}
