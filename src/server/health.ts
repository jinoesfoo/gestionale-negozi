// GET /api/health (FON-009): 200 con {status, version, db, placeholders} quando il database risponde, 503
// altrimenti, anche quando non risponde entro il tempo massimo. Senza login e senza dati: nessun dettaglio
// dell'errore, e `placeholders` dice solo se qualche variabile ha ancora un segnaposto, non quale.

export interface HealthDeps {
  /** Risolve se il database risponde. */
  pingDb: () => Promise<void>;
  /** La versione dell'app (APP_VERSION). */
  version: () => string;
  /** Vero se qualche variabile ha ancora un segnaposto dell'avvio iniziale. */
  placeholders: () => boolean;
  /** Attesa massima della risposta del database; poi 503. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3_000;

/** Vero se pingDb risolve entro timeoutMs; falso se rifiuta o se il tempo scade. */
async function databaseResponds(pingDb: () => Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  // Anche un errore lanciato prima della promessa (pingDb non asincrona) vale come database che non risponde.
  const ping = Promise.resolve()
    .then(pingDb)
    .then(
      () => true,
      () => false,
    );
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthHandler(deps: HealthDeps): () => Promise<Response> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async () => {
    const ok = await databaseResponds(deps.pingDb, timeoutMs);
    const state = ok ? 'ok' : 'error';
    return Response.json(
      { status: state, version: deps.version(), db: state, placeholders: deps.placeholders() },
      { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
    );
  };
}
