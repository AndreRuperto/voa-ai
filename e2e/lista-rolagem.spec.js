import { test, expect } from '@playwright/test';

// A lista de países rola dentro do campo; a barra de rolagem segue a do painel (fina, arredondada, sem setas),
// e não a cinza padrão do sistema. A largura é o que dá para medir: 10 px contra ~15 px da padrão.
test('lista de países usa a barra de rolagem do Voa Aí', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no celular a barra é sobreposta e não ocupa largura');
  await page.goto('/#rota');
  const campo = page.getByRole('combobox', { name: 'País de origem' });
  await expect(campo).toBeEnabled();
  await campo.click();
  const lista = page.getByRole('listbox', { name: 'País de origem' });
  await expect(lista).toBeVisible();
  const largura = await lista.evaluate(el => {
    const cs = getComputedStyle(el);
    return el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
  });
  expect(largura).toBe(10);
});
