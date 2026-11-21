// L'istanza pg-boss dell'app (01 §Client del database, FON-T10): una sola per processo, avviata al primo uso, solo per
// accodare (supervise: false, schedule: false, boss.ts). La usano l'avvio dell'app (ensureQueues in
// instrumentation-node.ts) e le route che accodano lavori, come il webhook delle email. Sta su globalThis, così il
// ricaricamento dei moduli di `next dev` non ne crea altre. Se l'avvio fallisce, la chiamata successiva riprova.
import type { PgBoss } from 'pg-boss';
import { createAppBoss } from './boss';

const HOLDER = Symbol.for('gestionale-negozi.app-boss');

interface Holder {
  starting?: Promise<PgBoss>;
}

function holder(): Holder {
  const scope = globalThis as typeof globalThis & { [HOLDER]?: Holder };
  scope[HOLDER] ??= {};
  return scope[HOLDER];
}

/** L'istanza dell'app, avviata (DATABASE_JOBS_URL, ruolo app_jobs). */
export function getAppBoss(): Promise<PgBoss> {
  const state = holder();
  if (state.starting === undefined) {
    const starting = (async () => {
      const boss = createAppBoss();
      // Un errore di pg-boss non fa cadere il processo; si scrive il messaggio, mai l'indirizzo del database.
      boss.on('error', (error: Error) => {
        console.error(`Errore della coda dei lavori (app): ${error.message}`);
      });
      await boss.start();
      return boss;
    })();
    state.starting = starting;
    starting.catch(() => {
      if (state.starting === starting) state.starting = undefined;
    });
  }
  return state.starting;
}

/** Ferma l'istanza dell'app, se avviata (fine dei test); la chiamata successiva a getAppBoss() ne crea una nuova. */
export async function stopAppBoss(): Promise<void> {
  const state = holder();
  const starting = state.starting;
  state.starting = undefined;
  if (starting === undefined) return;
  try {
    await (await starting).stop({ graceful: false });
  } catch {
    // Non avviata o già ferma: niente da fermare.
  }
}
