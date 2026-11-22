// Esclusioni dalle email (FON-011, 01 FON-T10). Con il client di DATABASE_URL: nell'app app_user (solo INSERT su
// email_suppressions, EXECUTE su audit_platform), nel worker app_worker (solo SELECT).
import { getPool } from './client';

export type SuppressionReason = 'bounce' | 'complaint';

/**
 * Registra l'esclusione (indirizzo in minuscolo). Nella stessa transazione: `INSERT … ON CONFLICT DO NOTHING` senza
 * nominare la colonna (con `ON CONFLICT (email)` servirebbe SELECT sulla colonna, che app_user non ha) e, solo se la
 * riga è nuova (una riga inserita, nessuna lettura preventiva né RETURNING), la riga `email_suppressed` del registro
 * di piattaforma con audit_platform. Restituisce vero se la riga è nuova: solo allora si accoda l'avviso, dopo il commit.
 */
export async function recordEmailSuppression(email: string, reason: SuppressionReason): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const client = await getPool().connect();
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
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Vero se l'indirizzo è escluso dagli invii (lettura del worker, prima di ogni `email.send`). */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  const result = await getPool().query('SELECT 1 FROM public.email_suppressions WHERE email = $1', [
    email.trim().toLowerCase(),
  ]);
  return (result.rowCount ?? 0) > 0;
}
