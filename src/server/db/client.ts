// Client del database dell'app e del worker (01 §Client del database, 00 R-DATI-3). È l'unico file che legge
// DATABASE_URL: app_user nell'app, app_worker nel worker, con la stessa forma. Il pool nasce al primo uso, non
// all'importazione, così `next build` non ha bisogno del database. Le sue esportazioni sono per uso interno a
// src/server/db/: il resto del codice passa da withShop() e dalle funzioni di questa cartella.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/** Massimo di connessioni del pool: 20 in produzione (01 §Client del database), 10 (il predefinito di pg) altrove. */
const MAX_CONNECTIONS = process.env.NODE_ENV === 'production' ? 20 : 10;
/** Attesa massima di una connessione nuova, così una richiesta non resta appesa a un database che non risponde. */
const CONNECTION_TIMEOUT_MS = 5_000;

let pool: Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

/** Il pool di DATABASE_URL, creato alla prima chiamata. */
export function getPool(): Pool {
  if (pool === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString === '') {
      throw new Error('Manca DATABASE_URL.');
    }
    const created = new Pool({
      connectionString,
      max: MAX_CONNECTIONS,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });
    // Una connessione inattiva che cade (database riavviato) emette 'error' sul pool: senza ascoltatore il processo
    // terminerebbe. Il pool la scarta da sé; si scrive solo il codice dell'errore, non il messaggio.
    created.on('error', (error: Error & { code?: string }) => {
      console.error(`Connessione inattiva del database caduta (${error.code ?? 'senza codice'}).`);
    });
    pool = created;
  }
  return pool;
}

/** L'istanza Drizzle sul pool di DATABASE_URL. */
export function getDb(): NodePgDatabase<typeof schema> {
  db ??= drizzle({ client: getPool(), schema });
  return db;
}

/** Chiude il pool (fine del processo, test); la chiamata successiva a getPool() ne crea uno nuovo. */
export async function closeDb(): Promise<void> {
  const open = pool;
  pool = undefined;
  db = undefined;
  await open?.end();
}
