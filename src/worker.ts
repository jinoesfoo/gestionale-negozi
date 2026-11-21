// Worker (01 §Servizi Docker Compose, FON-002; versione minima di FON-T06 e FON-T07b): valida l'ambiente del worker
// come prima istruzione, poi si collega alla coda dei lavori come app_jobs (DATABASE_JOBS_URL, schema pgboss) e resta
// in attesa fino a SIGTERM o SIGINT, quando ferma pg-boss ed esce con 0. FON-T10 lo sostituisce con lo scheletro
// completo (code, lavori, email). Sui server `node dist/worker.js`; in sviluppo `pnpm worker` (con .env.worker).
import { EnvError, parseWorkerEnv, type WorkerEnv } from '@/config/env';
import { isEntryPoint } from '@/lib/entry-point';
import { createWorkerBoss } from '@/server/jobs/boss';

/** Il worker avviato. */
export interface RunningWorker {
  /** Ferma pg-boss (i lavori in corso finiscono, come da opzioni predefinite di stop()). */
  stop: () => Promise<void>;
}

/**
 * Valida l'ambiente e avvia pg-boss. Se manca o è sbagliata una variabile, o c'è DATABASE_OWNER_URL (anche vuota), ne
 * scrive il nome ed esce con 1, senza collegarsi a nulla.
 */
export async function startWorker(env: Record<string, string | undefined>): Promise<RunningWorker> {
  let parsed: WorkerEnv;
  try {
    parsed = parseWorkerEnv(env);
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    // Solo i nomi delle variabili, mai i valori.
    console.error(`Avvio del worker rifiutato. ${error.message}`);
    process.exit(1);
  }

  const boss = createWorkerBoss(parsed.DATABASE_JOBS_URL);
  // Senza ascoltatore, un errore di pg-boss (per esempio il database riavviato) farebbe cadere il processo.
  boss.on('error', (error: Error) => {
    console.error(`Errore della coda dei lavori: ${error.message}`);
  });
  await boss.start();
  console.log(`Worker avviato (versione ${parsed.APP_VERSION}).`);
  return {
    stop: async () => {
      await boss.stop();
    },
  };
}

if (isEntryPoint(import.meta.url, 'worker')) {
  try {
    const worker = await startWorker(process.env);
    let stopping = false;
    const onSignal = (signal: NodeJS.Signals) => {
      if (stopping) return;
      stopping = true;
      console.log(`Worker: ricevuto ${signal}, arresto.`);
      worker.stop().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error('Arresto del worker non riuscito.', error);
          process.exit(1);
        },
      );
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
  } catch (error) {
    console.error('Avvio del worker non riuscito.', error);
    process.exit(1);
  }
}
