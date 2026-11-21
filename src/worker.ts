// Worker (01 §Servizi Docker Compose, FON-002; scheletro di FON-T10). Resta corto: avvio, code, registrazione dei
// lavori, arresto; i lavori stanno in src/server/jobs/ (un file per lavoro e registry.ts). Sui server
// `node dist/worker.js`; in sviluppo `pnpm worker` (con .env.worker).
//
// 1. valida l'ambiente del worker come prima istruzione (senza una variabile, o con DATABASE_OWNER_URL anche vuota,
//    scrive il nome ed esce con 1, senza collegarsi a nulla);
// 2. registra i gestori di SIGTERM e SIGINT prima di avviare pg-boss: nel container Node è il processo 1 e ignora i
//    segnali senza gestore (nota (20) di FON-T06); un segnale arrivato durante l'avvio ferma pg-boss appena avviato;
// 3. si collega alla coda come app_jobs (DATABASE_JOBS_URL, schema pgboss), crea e controlla le code con
//    ensureQueues() (una coda esistente con un'altra politica: esce con 1) e registra i gestori dei lavori;
// 4. all'arresto ferma pg-boss aspettando i lavori in corso, entro i 10 secondi di `docker stop`, ed esce con 0.
import { EnvError, parseWorkerEnv, type WorkerEnv } from '@/config/env';
import { isEntryPoint } from '@/lib/entry-point';
import { errorMessage } from '@/lib/errors';
import { isEmailSuppressed } from '@/server/db/email-suppressions';
import { createEmailSender } from '@/server/email/provider';
import { createWorkerBoss } from '@/server/jobs/boss';
import { QueueConfigError, ensureQueues } from '@/server/jobs/queues';
import { registerJobs } from '@/server/jobs/registry';

/** Attesa massima dei lavori in corso all'arresto: meno dei 10 secondi dopo cui `docker stop` uccide il processo. */
export const WORKER_STOP_TIMEOUT_MS = 8000;

/** Il worker avviato. */
export interface RunningWorker {
  /** Ferma pg-boss, aspettando i lavori in corso fino a WORKER_STOP_TIMEOUT_MS. */
  stop: () => Promise<void>;
}

/** Il processo, per main(): i segnali e l'uscita (nei test un processo finto). */
export interface WorkerProcess {
  on(signal: 'SIGTERM' | 'SIGINT', listener: (signal: NodeJS.Signals) => void): unknown;
  exit(code: number): void;
}

type Env = Record<string, string | undefined>;
type Exit = (code: number) => void;

/** Valida l'ambiente; se non va, scrive i nomi delle variabili (mai i valori) e chiede l'uscita con 1. */
function validate(env: Env, exit: Exit): WorkerEnv | undefined {
  try {
    return parseWorkerEnv(env);
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    console.error(`Avvio del worker rifiutato. ${error.message}`);
    exit(1);
    return undefined;
  }
}

/**
 * Avvia pg-boss, crea e controlla le code, registra i lavori. `shouldStop` vero (un segnale arrivato durante l'avvio)
 * ferma la sequenza dopo l'avvio di pg-boss: chi chiama ferma il worker restituito. Un errore chiede l'uscita con 1.
 */
async function launch(parsed: WorkerEnv, exit: Exit, shouldStop: () => boolean): Promise<RunningWorker | undefined> {
  const boss = createWorkerBoss(parsed.DATABASE_JOBS_URL);
  // Senza ascoltatore, un errore di pg-boss (per esempio il database riavviato) farebbe cadere il processo.
  boss.on('error', (error: Error) => {
    console.error(`Errore della coda dei lavori: ${error.message}`);
  });
  const worker: RunningWorker = {
    stop: async () => {
      await boss.stop({ graceful: true, timeout: WORKER_STOP_TIMEOUT_MS });
    },
  };

  try {
    await boss.start();
  } catch (error) {
    console.error(`Avvio del worker non riuscito: la coda dei lavori non risponde (${errorMessage(error)}).`);
    exit(1);
    return undefined;
  }
  if (shouldStop()) return worker;

  try {
    await ensureQueues(boss);
  } catch (error) {
    const detail = error instanceof QueueConfigError ? error.message : `code non pronte (${errorMessage(error)})`;
    console.error(`Avvio del worker rifiutato. ${detail}`);
    await boss.stop({ graceful: false }).catch(() => undefined);
    exit(1);
    return undefined;
  }
  if (shouldStop()) return worker;

  await registerJobs(boss, { sender: createEmailSender(parsed), isSuppressed: isEmailSuppressed });
  console.log(`Worker avviato (versione ${parsed.APP_VERSION}).`);
  return worker;
}

/** Valida l'ambiente e avvia il worker; un errore scrive il motivo ed esce con 1 (process.exit). */
export async function startWorker(env: Env): Promise<RunningWorker> {
  const exit: Exit = (code) => process.exit(code);
  const parsed = validate(env, exit);
  if (parsed === undefined) return process.exit(1);
  const worker = await launch(parsed, exit, () => false);
  if (worker === undefined) return process.exit(1);
  return worker;
}

/** Il programma del worker: validazione, gestori dei segnali, avvio; un segnale ferma pg-boss ed esce con 0. */
export async function main(env: Env, proc: WorkerProcess = process): Promise<void> {
  const exit: Exit = (code) => proc.exit(code);
  const parsed = validate(env, exit);
  if (parsed === undefined) return;

  const current: { worker?: RunningWorker } = {};
  let started = false;
  let stopping = false;
  const shutdown = async () => {
    try {
      await current.worker?.stop();
      exit(0);
    } catch (error) {
      console.error(`Arresto del worker non riuscito: ${errorMessage(error)}`);
      exit(1);
    }
  };
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.log(`Worker: ricevuto ${signal}, arresto.`);
    // Durante l'avvio l'arresto lo fa la sequenza qui sotto, appena pg-boss è avviato.
    if (started) void shutdown();
  };
  proc.on('SIGTERM', onSignal);
  proc.on('SIGINT', onSignal);

  current.worker = await launch(parsed, exit, () => stopping);
  started = true;
  if (current.worker === undefined) return;
  if (stopping) await shutdown();
}

if (isEntryPoint(import.meta.url, 'worker')) {
  main(process.env).catch((error: unknown) => {
    console.error(`Avvio del worker non riuscito: ${errorMessage(error)}`);
    process.exit(1);
  });
}
