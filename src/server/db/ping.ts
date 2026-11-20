// Prova che il database risponde, per /api/health (FON-009). Non legge dati: SELECT 1 sul pool di DATABASE_URL.
import type { QueryConfig } from 'pg';
import { getPool } from './client';

/**
 * Attesa massima della risposta a SELECT 1, oltre i 3 secondi dopo cui /api/health risponde già 503. Senza questo
 * limite, su una connessione caduta senza chiudersi (rete interrotta) la query resterebbe appesa per minuti, finché il
 * sistema operativo non chiude la connessione, e ogni controllo di salute terrebbe occupato un posto del pool.
 * Scaduto il tempo, pg rifiuta la query e il pool scarta la connessione invece di rimetterla fra quelle libere.
 */
const PING_QUERY_TIMEOUT_MS = 5_000;

/**
 * Il limite vale solo per questa query, non per tutto il pool. pg legge `query_timeout` anche dalla configurazione
 * della singola query (lib/client.js di pg 8.23), ma @types/pg non lo dichiara in QueryConfig.
 */
type QueryConfigWithTimeout = QueryConfig & { query_timeout: number };

/** Risolve se il database risponde a SELECT 1; altrimenti rifiuta con l'errore del driver. */
export async function pingDatabase(): Promise<void> {
  const ping: QueryConfigWithTimeout = { text: 'SELECT 1', query_timeout: PING_QUERY_TIMEOUT_MS };
  await getPool().query(ping);
}
