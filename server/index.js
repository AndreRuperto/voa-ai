// Ponto de entrada: carrega o .env (se existir), abre o banco, sobe o HTTP e o agendador.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const arquivoEnv = join(RAIZ, '.env');
if (existsSync(arquivoEnv)) {
  try { process.loadEnvFile(arquivoEnv); } catch (e) { console.warn(`[env] não li o .env: ${e.message}`); }
}

// AeroAPI simulada usa um banco à parte, para não misturar voos e gastos de mentira com os de verdade.
if (process.env.AEROAPI_SIMULADA === '1' && !process.env.DB_CAMINHO) process.env.DB_CAMINHO = join(RAIZ, 'dados', 'simulado.sqlite');

const { criarContexto, criarApp } = await import('./app.js');
const { iniciarAgendador } = await import('./agendador.js');

const ctx = criarContexto();
const servidor = createServer(criarApp(ctx));
const parar = iniciarAgendador(ctx);
const porta = Number(process.env.PORT) || 3000;

servidor.listen(porta, () => {
  console.log(`Voa Aí no ar em http://localhost:${porta}`);
  if (ctx.simulada) console.log('AeroAPI SIMULADA (banco dados/simulado.sqlite). Voos: TP1018, TP103, G31402, AD4510, LA8084.');
  else if (!ctx.aeroapi.temChave()) console.log('AEROAPI_KEY vazia: rotas que dependem da AeroAPI respondem 503 aeroapi_sem_chave.');
  if (!process.env.WEBHOOK_SEGREDO) console.log('WEBHOOK_SEGREDO vazio: o webhook responde 404 para tudo.');
  if (!process.env.GOOGLE_CLIENT_ID) console.log('GOOGLE_CLIENT_ID vazio: o login com Google fica desligado.');
});

async function desligar(sinal) {
  console.log(`${sinal}: desligando…`);
  parar();
  servidor.close();
  await ctx.aguardarTarefas();
  ctx.db.close();
  process.exit(0);
}
process.on('SIGINT', () => desligar('SIGINT'));
process.on('SIGTERM', () => desligar('SIGTERM'));
