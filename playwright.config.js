// E2E do Voa Aí: sobe o servidor com a AeroAPI simulada (banco à parte, em dados/) e testa no Chromium.
// Rodar: npm run test:e2e
import { defineConfig, devices } from '@playwright/test';

const PORTA = 3107;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/resultados',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORTA}`,
    // pt-BR de propósito: é o idioma que antes punha "Brasil" no "Para" sozinho
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'celular', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    command: 'node --env-file=simulacao.env server/index.js',
    url: `http://localhost:${PORTA}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORTA), SIM_DB_CAMINHO: 'dados/e2e.sqlite', URL_PUBLICA: `http://localhost:${PORTA}` },
  },
});
