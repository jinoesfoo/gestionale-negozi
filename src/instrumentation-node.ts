// Operazioni di avvio dell'app nel runtime Node.js, chiamate da register() in instrumentation.ts.
import { EnvError, parseAppEnv } from '@/config/env';

/** Valida l'ambiente dell'app; se manca o è sbagliata una variabile, ne scrive il nome ed esce con 1. */
export function startApp(): void {
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
}
