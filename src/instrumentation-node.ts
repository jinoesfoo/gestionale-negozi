// Operazioni di avvio dell'app nel runtime Node.js, chiamate da register() in instrumentation.ts.
import { EnvError, parseAppEnv } from '@/config/env';
import { errorMessage } from '@/lib/errors';
import { getAppBoss } from '@/server/jobs/app-boss';
import { QueueConfigError, ensureQueues } from '@/server/jobs/queues';

/**
 * Valida l'ambiente dell'app; se manca o è sbagliata una variabile, ne scrive il nome ed esce con 1. Poi, con
 * l'istanza pg-boss dell'app (app_jobs), crea e controlla le code con ensureQueues() (FON-T10: l'app può partire prima
 * del worker, e in pg-boss 12 `send` su una coda inesistente fallisce); se le code non sono pronte (database che non
 * risponde, coda con un'altra politica) esce con 1 e lo dice (nota (4) del piano di FON-T10).
 */
export async function startApp(): Promise<void> {
  let failure: EnvError | undefined;
  try {
    parseAppEnv(process.env);
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    failure = error;
  }
  if (failure) {
    // Solo i nomi delle variabili, mai i valori.
    console.error(`Avvio dell'app rifiutato. ${failure.message}`);
    process.exit(1);
  }

  let queuesProblem: string | undefined;
  try {
    await ensureQueues(await getAppBoss());
  } catch (error) {
    queuesProblem =
      error instanceof QueueConfigError ? error.message : `La coda dei lavori non risponde (${errorMessage(error)}).`;
  }
  if (queuesProblem !== undefined) {
    console.error(`Avvio dell'app rifiutato: code dei lavori non pronte. ${queuesProblem}`);
    process.exit(1);
  }
}
