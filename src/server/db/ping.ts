// Prova che il database risponde, per /api/health (FON-009). Non legge dati: SELECT 1 sul pool di DATABASE_URL.
import { getPool } from './client';

/** Risolve se il database risponde a SELECT 1; altrimenti rifiuta con l'errore del driver. */
export async function pingDatabase(): Promise<void> {
  await getPool().query('SELECT 1');
}
