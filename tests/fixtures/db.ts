// Client del database per ruolo, per i test di integrazione (01 §Variabili d'ambiente, 00 R-DATI-3: i test sono
// l'eccezione dichiarata alla regola sul client). Ogni ruolo ha la sua connessione, presa dalle variabili caricate dal
// setup: owner (app_owner, solo fixture e controlli del catalogo e dei permessi), app (app_user), worker (app_worker),
// jobs (app_jobs). Gli errori nominano le variabili, mai i valori.
import { Pool } from 'pg';

const ROLE_URL = {
  owner: 'TEST_DATABASE_OWNER_URL',
  app: 'TEST_DATABASE_APP_URL',
  worker: 'TEST_DATABASE_WORKER_URL',
  jobs: 'TEST_DATABASE_JOBS_URL',
} as const;

export type TestRole = keyof typeof ROLE_URL;

/** L'indirizzo del database per il ruolo; con `database`, lo stesso indirizzo verso un altro database. */
export function testDatabaseUrl(role: TestRole, database?: string): string {
  const name = ROLE_URL[role];
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Manca ${name}: il setup dei test di integrazione carica .env.test e .env.test.owner.`);
  }
  if (database === undefined) return value;
  const url = new URL(value);
  url.pathname = `/${database}`;
  return url.toString();
}

const pools = new Map<string, Pool>();

/** Un pool per ruolo (e per database), creato al primo uso e riusato nel file di test. */
export function rolePool(role: TestRole, database?: string): Pool {
  const key = `${role}/${database ?? ''}`;
  let pool = pools.get(key);
  if (pool === undefined) {
    pool = new Pool({ connectionString: testDatabaseUrl(role, database), max: 2 });
    pools.set(key, pool);
  }
  return pool;
}

/** Chiude i pool aperti da rolePool (da chiamare in afterAll). */
export async function closeRolePools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((pool) => pool.end()));
}
