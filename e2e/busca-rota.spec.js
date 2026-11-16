import { test, expect } from '@playwright/test';

/** Escolhe o país digitando, como uma pessoa faria. */
async function escolherPais(page, lado, termo) {
  const campo = page.getByRole('combobox', { name: lado === 'de' ? 'País de origem' : 'País de destino' });
  await expect(campo).toBeEnabled();
  await campo.fill(termo);
  await campo.press('Enter');
}

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
    // sem país, não há aeroporto para buscar
    await expect(page.getByRole('combobox', { name: 'Buscar aeroporto de destino' })).toBeHidden();
  });

  test('digitar a cidade e marcar o aeroporto com o teclado', async ({ page }) => {
    await page.goto('/#rota');
    await escolherPais(page, 'para', 'brasil');
    await expect(page.getByRole('combobox', { name: 'País de destino' })).toHaveValue('Brasil');

    const busca = page.getByRole('combobox', { name: 'Buscar aeroporto de destino' });
    await expect(busca).toBeVisible();
    await expect(busca).toHaveAttribute('aria-expanded', 'false');

    await busca.fill('salvador');
    await expect(busca).toHaveAttribute('aria-expanded', 'true');
    const lista = page.getByRole('listbox', { name: 'Aeroportos de destino encontrados' });
    await expect(lista.getByRole('option').first()).toContainText('SSA');
    // o resultado é anunciado para o leitor de tela
    await expect(page.locator('#busca-para-status')).toContainText(/1 aeroporto\b/);

    await busca.press('Enter');
    await expect(page.locator('#aero-para input[value="SSA"]')).toBeChecked();
    await expect(busca).toHaveValue('');
    await expect(busca).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#busca-para-status')).toContainText('Marcado: SSA');
    // foco continua no campo para marcar outro
    await expect(busca).toBeFocused();

    // setas mudam a opção ativa; Enter marca a ativa
    await busca.fill('rio de janeiro');
    const opcoes = lista.getByRole('option');
    await expect(opcoes).toHaveCount(2);
    const segunda = await opcoes.nth(1).getAttribute('data-iata');
    await busca.press('ArrowDown');
    await expect(busca).toHaveAttribute('aria-activedescendant', await opcoes.nth(1).getAttribute('id'));
    await busca.press('Enter');
    await expect(page.locator(`#aero-para input[value="${segunda}"]`)).toBeChecked();
    await expect(page.locator('#aero-para input:checked')).toHaveCount(2);

    // Esc fecha sem marcar e limpa o texto
    await busca.fill('xyz');
    await expect(page.locator('#busca-para-status')).toContainText('Nenhum aeroporto com “xyz”');
    await busca.press('Escape');
    await expect(busca).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#aero-para input:checked')).toHaveCount(2);
  });

  test('digitar a cidade, tocar no resultado e buscar os voos', async ({ page }) => {
    await page.goto('/#rota');
    await escolherPais(page, 'de', 'portugal');
    // no "De" o maior aeroporto já vem marcado (LIS)
    await expect(page.locator('#aero-de input[value="LIS"]')).toBeChecked();

    await escolherPais(page, 'para', 'brasil');
    const busca = page.getByRole('combobox', { name: 'Buscar aeroporto de destino' });
    await busca.fill('guarulhos');
    await page.getByRole('option', { name: /GRU/ }).click();
    await expect(page.locator('#aero-para input[value="GRU"]')).toBeChecked();
    await expect(page.locator('#pares-dica')).toHaveText(/1 combinação/);

    await page.getByRole('button', { name: 'Buscar voos' }).click();
    await expect(page.locator('#lista-rota')).toContainText('TP103');
  });

  test('marcar pela busca respeita o limite de combinações', async ({ page }) => {
    await page.goto('/#rota');
    await escolherPais(page, 'de', 'portugal');
    await escolherPais(page, 'para', 'brasil');
    const busca = page.getByRole('combobox', { name: 'Buscar aeroporto de destino' });
    for (const c of ['GRU', 'GIG', 'BSB']) { await busca.fill(c); await busca.press('Enter'); }
    await expect(page.locator('#aero-para input:checked')).toHaveCount(3);
    await busca.fill('SSA'); await busca.press('Enter');
    await expect(page.locator('#aero-para input[value="SSA"]')).not.toBeChecked();
    await expect(page.locator('#busca-para-status')).toContainText('No máximo 3 combinações');
  });
});
