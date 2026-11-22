// Preparazione globale dei progetti di integrazione (01 §CI/CD, FON-T10): prima del primo test crea le code dei
// lavori con ensureQueues(), come fanno l'app e il worker all'avvio, perché in pg-boss 12 `send` su una coda
// inesistente fallisce. Gira una volta per progetto, nel processo principale di Vitest: legge .env.test in un oggetto
// suo, senza toccare process.env (che i processi dei test erediterebbero), e usa la connessione di app_jobs.
// ensureQueues è idempotente, e due esecuzioni insieme non si danno fastidio (createQueue prende un blocco consultivo).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { createAppBoss } from '../../src/server/jobs/boss';
import { ensureQueues } from '../../src/server/jobs/queues';

const root = join(import.meta.dirname, '..', '..');

export default async function setup(): Promise<void> {
  const file = join(root, '.env.test');
  if (!existsSync(file)) {
    throw new Error('Manca .env.test: crealo copiando .env.test.example (AVVIO.md, «Fuori da GitHub»).');
  }
  const url = parseEnv(readFileSync(file, 'utf8')).TEST_DATABASE_JOBS_URL;
  if (url === undefined || url === '') {
    throw new Error('Manca TEST_DATABASE_JOBS_URL in .env.test: confrontalo con .env.test.example.');
  }
  const boss = createAppBoss(url);
  boss.on('error', (error: Error) => {
    console.error(`Errore della coda dei lavori nella preparazione dei test: ${error.message}`);
  });
  await boss.start();
  try {
    await ensureQueues(boss);
  } finally {
    await boss.stop({ graceful: false });
  }
}
