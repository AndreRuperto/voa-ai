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
    const pais = page.getByRole('combobox', { name: 'País de destino' });
    await page.waitForFunction(() => !document.querySelector('#pais-para-campo').disabled);
    await page.waitForTimeout(500);
    // o topo (logo, "Meus voos") é fixo: deixa uma folga para ele não cobrir o campo
    const mostrarPara = () => page.locator('#pais-para').evaluate(el => {
      el.scrollIntoView({ block: 'start' });
      scrollBy(0, -140);
      let p = el.parentElement;
      while (p && p !== document.body) { if (p.scrollHeight > p.clientHeight + 4) p.scrollBy(0, -140); p = p.parentElement; }
    });
    await page.screenshot({ path: `${PASTA}/${t.nome}-1-inicio.png` });

    const busca = page.getByRole('combobox', { name: 'Buscar aeroporto de destino' });
    if (!(await page.locator('#busca-para').count())) return;   // antes da busca existir
    await pais.fill('bras');
    await pais.press('Enter');
    await busca.waitFor();
    await mostrarPara();
    await page.screenshot({ path: `${PASTA}/${t.nome}-2-pais.png` });
    await busca.fill('sal');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${PASTA}/${t.nome}-3-digitando.png` });
    await busca.press('Enter');
    await busca.fill('rio');
    await busca.press('ArrowDown');
    await busca.press('Enter');
    await page.waitForTimeout(200);
    await mostrarPara();
    await page.screenshot({ path: `${PASTA}/${t.nome}-4-marcados.png` });
  });
}
