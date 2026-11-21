// Le code dei lavori della fase 0 (05 §Lavori periodici, 01 FON-T10). ensureQueues() le crea all'avvio del worker e
// dell'app e nel setup dei test di integrazione: in pg-boss 12 `send` su una coda inesistente fallisce, e l'app può
// partire prima del worker. `createQueue` è idempotente, ma su una coda esistente non fa nulla e la politica non si
// cambia dopo la creazione: per questo, dopo averle create, le rilegge con getQueue() e si ferma con un messaggio
// chiaro se una coda è diversa da quella dichiarata (la correzione è cancellarla e ricrearla vuota, a mano). Crea
// **solo le code**: ogni pianificazione la registra, insieme al suo gestore, il compito che scrive il lavoro.

export type QueuePolicyName = 'standard' | 'singleton';

export interface QueueDefinition {
  readonly name: string;
  readonly policy: QueuePolicyName;
  /** Tentativi dichiarati sulla coda; senza, vale il predefinito di pg-boss e non si controlla. */
  readonly retryLimit?: number;
  readonly retryBackoff?: boolean;
}

/** L'elenco completo delle code della fase 0; politica `standard` dove 05 non ne indica un'altra. */
export const QUEUES: readonly QueueDefinition[] = [
  // Una sola sincronizzazione attiva per cliente (singletonKey = customerId), nessun invio scartato (05 §billing.sync).
  { name: 'billing.sync', policy: 'singleton' },
  { name: 'billing.events.retry', policy: 'standard' },
  { name: 'billing.sweep', policy: 'standard' },
  { name: 'shops.purge', policy: 'standard' },
  { name: 'shops.closeInactiveTrials', policy: 'standard' },
  { name: 'email.send', policy: 'standard' },
  { name: 'modules.trialReminders', policy: 'standard' },
  // I 5 tentativi di BIL-016: il predefinito di pg-boss è 2 (05 §Lavori periodici).
  { name: 'invoicing.sdi', policy: 'singleton', retryLimit: 5, retryBackoff: true },
  { name: 'invoicing.pollStatus', policy: 'standard' },
  { name: 'exports.build', policy: 'standard' },
  { name: 'exports.cleanup', policy: 'standard' },
  { name: 'audit.redactIps', policy: 'standard' },
  { name: 'auth.cleanupLoginFailures', policy: 'standard' },
];

/** Le sole operazioni di pg-boss che servono a ensureQueues (le ha l'istanza PgBoss). */
export interface QueueAdmin {
  createQueue(
    name: string,
    options: { policy: QueuePolicyName; retryLimit?: number; retryBackoff?: boolean },
  ): Promise<void>;
  getQueue(name: string): Promise<{ policy?: string; retryLimit?: number; retryBackoff?: boolean } | null>;
}

/** Code esistenti diverse da quelle dichiarate: l'avvio si ferma (worker e app escono con 1). */
export class QueueConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Code dei lavori diverse da quelle dichiarate in src/server/jobs/queues.ts: ${problems.join('; ')}. ` +
        'In pg-boss la politica e i tentativi di una coda non si cambiano dopo la creazione: la correzione è ' +
        'cancellare la coda vuota e ricrearla, a mano (05 §billing.sync).',
    );
    this.name = 'QueueConfigError';
  }
}

/** Le differenze fra la coda salvata e quella dichiarata. */
function differences(
  queue: QueueDefinition,
  stored: { policy?: string; retryLimit?: number; retryBackoff?: boolean } | null,
): string[] {
  if (stored === null) return [`la coda ${queue.name} non esiste dopo createQueue`];
  const found: string[] = [];
  const policy = stored.policy ?? 'standard';
  if (policy !== queue.policy) {
    found.push(`la coda ${queue.name} ha la politica ${policy} invece di ${queue.policy}`);
  }
  if (queue.retryLimit !== undefined && stored.retryLimit !== queue.retryLimit) {
    found.push(`la coda ${queue.name} ha ${String(stored.retryLimit)} tentativi invece di ${queue.retryLimit}`);
  }
  if (queue.retryBackoff !== undefined && stored.retryBackoff !== queue.retryBackoff) {
    found.push(
      `la coda ${queue.name} ${stored.retryBackoff ? 'ha' : 'non ha'} l'attesa crescente fra i tentativi ` +
        `(retryBackoff ${String(stored.retryBackoff)} invece di ${String(queue.retryBackoff)})`,
    );
  }
  return found;
}

/** Crea le code che mancano, poi controlla tutte quelle dell'elenco; si ferma con QueueConfigError se una è diversa. */
export async function ensureQueues(boss: QueueAdmin, queues: readonly QueueDefinition[] = QUEUES): Promise<void> {
  for (const queue of queues) {
    const options: { policy: QueuePolicyName; retryLimit?: number; retryBackoff?: boolean } = { policy: queue.policy };
    if (queue.retryLimit !== undefined) options.retryLimit = queue.retryLimit;
    if (queue.retryBackoff !== undefined) options.retryBackoff = queue.retryBackoff;
    await boss.createQueue(queue.name, options);
  }
  const problems: string[] = [];
  for (const queue of queues) problems.push(...differences(queue, await boss.getQueue(queue.name)));
  if (problems.length > 0) throw new QueueConfigError(problems);
}
