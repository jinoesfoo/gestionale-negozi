// Connessioni con le credenziali del proprietario (01 §Client del database, 00 R-DATI-3): si importa solo dai punti
// di ingresso src/migrate.ts, src/cli.ts, src/isolation-check.ts e dai comandi src/cli/commands/**. L'indirizzo lo
// passa chi chiama, dopo aver validato il proprio ambiente (DATABASE_OWNER_URL, come app_owner).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export interface OwnerConnection {
  db: NodePgDatabase;
  /** Chiude la connessione: la chiama chi l'ha aperta, anche in caso di errore. */
  close: () => Promise<void>;
}

/** Una connessione come app_owner, con una sola connessione al database (migrazioni e comandi sono sequenziali). */
export function createOwnerConnection(url: string): OwnerConnection {
  const pool = new Pool({ connectionString: url, max: 1 });
  // Come in client.ts: fra una query e l'altra la connessione torna libera nel pool, e se cade lì (database riavviato)
  // il pool emette 'error'; senza ascoltatore il processo terminerebbe con un errore non gestito. La query successiva
  // apre una connessione nuova, o fallisce con il suo errore. Si scrive solo il codice dell'errore, non il messaggio.
  pool.on('error', (error: Error & { code?: string }) => {
    console.error(`Connessione inattiva del proprietario caduta (${error.code ?? 'senza codice'}).`);
  });
  return { db: drizzle({ client: pool }), close: () => pool.end() };
}
