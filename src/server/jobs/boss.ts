// Istanze di pg-boss (01 §Client del database, FON-003): la coda dei lavori nello schema pgboss, con la connessione
// DATABASE_JOBS_URL (ruolo app_jobs), che installa o aggiorna lo schema da sé a start(). Nell'app l'istanza serve solo
// ad accodare: niente manutenzione né pianificazione, che fa solo il worker (altrimenti due processi si
// contenderebbero i lavori pianificati).
import { PgBoss, type ConstructorOptions } from 'pg-boss';

const SCHEMA = 'pgboss';

/** Opzioni dell'istanza dell'app: solo accodare. */
export function appBossOptions(connectionString: string): ConstructorOptions {
  return { connectionString, schema: SCHEMA, supervise: false, schedule: false };
}

/** Opzioni dell'istanza del worker: manutenzione e pianificazione comprese. */
export function workerBossOptions(connectionString: string): ConstructorOptions {
  return { connectionString, schema: SCHEMA, supervise: true, schedule: true };
}

function jobsUrl(): string {
  const url = process.env.DATABASE_JOBS_URL;
  if (url === undefined || url === '') throw new Error('Manca DATABASE_JOBS_URL.');
  return url;
}

/** L'istanza pg-boss dell'app, da avviare con start(); per i test si può passare un altro indirizzo. */
export function createAppBoss(url: string = jobsUrl()): PgBoss {
  return new PgBoss(appBossOptions(url));
}

/** L'istanza pg-boss del worker, da avviare con start(); per i test si può passare un altro indirizzo. */
export function createWorkerBoss(url: string = jobsUrl()): PgBoss {
  return new PgBoss(workerBossOptions(url));
}
