// Esclusioni dalle email (FON-011, 01 FON-T10). Con il client di DATABASE_URL: nell'app app_user (solo INSERT su
// email_suppressions, EXECUTE su audit_platform), nel worker app_worker (solo SELECT). Allineate a NEG-T02 (nota (13)
// del ritorno al piano): gli errori escono come DbError, senza il `detail` di pg che contiene l'indirizzo (00 §4.2), e
// la connessione presa per la transazione si ascolta e si distrugge dopo un errore come in context.ts.
import type { PoolClient } from 'pg';
import { getPool } from './client';
import { toDbError } from './errors';

export type SuppressionReason = 'bounce' | 'complaint';

/**
 * Registra l'esclusione (indirizzo in minuscolo). Nella stessa transazione: `INSERT … ON CONFLICT DO NOTHING` senza
 * nominare la colonna (con `ON CONFLICT (email)` servirebbe SELECT sulla colonna, che app_user non ha) e, solo se la
 * riga è nuova (una riga inserita, nessuna lettura preventiva né RETURNING), la riga `email_suppressed` del registro
 * di piattaforma con audit_platform. Restituisce vero se la riga è nuova: solo allora si accoda l'avviso, dopo il commit.
 */
export async function recordEmailSuppression(email: string, reason: SuppressionReason): Promise<boolean> {
  const address = email.trim().toLowerCase();
  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (error) {
    throw toDbError(error);
  }
  // Mentre la connessione è fuori dal pool, pg-pool non ne ascolta gli errori: senza ascoltatore una connessione che
  // cade emetterebbe 'error' come eccezione non gestita.
  let broken = false;
  const onError = () => {
    broken = true;
  };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      'INSERT INTO public.email_suppressions (email, reason) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [address, reason],
    );
    const isNew = inserted.rowCount === 1;
    if (isNew) {
      await client.query(
        `SELECT public.audit_platform('system', NULL, 'email_suppressed', 'email_suppression', $1::text, NULL,
                jsonb_build_object('reason', $2::text), NULL, NULL)`,
        [address, reason],
      );
    }
    await client.query('COMMIT');
    return isNew;
  } catch (error) {
    // Un ROLLBACK fallito lascia la connessione in uno stato sconosciuto: si distrugge.
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw toDbError(error);
  } finally {
    client.off('error', onError);
    client.release(broken ? new Error('Connessione scartata dopo un errore.') : undefined);
  }
}

/**
 * Vero se l'indirizzo è escluso dagli invii (lettura del worker, prima di ogni `email.send`). L'ascolto degli errori e
 * la distruzione della connessione li fa `pool.query` di pg-pool; gli errori escono come DbError.
 */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  try {
    const result = await getPool().query('SELECT 1 FROM public.email_suppressions WHERE email = $1', [
      email.trim().toLowerCase(),
    ]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    throw toDbError(error);
  }
}
