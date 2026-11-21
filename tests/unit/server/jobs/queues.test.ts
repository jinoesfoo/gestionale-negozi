import { describe, expect, it, vi } from 'vitest';
import { QUEUES, QueueConfigError, ensureQueues, type QueueDefinition } from '@/server/jobs/queues';

// Le code dei lavori (01 FON-T10, 05 §Lavori periodici): ensureQueues() le crea all'avvio del worker e dell'app e nel
// setup dei test di integrazione, perché in pg-boss 12 `send` su una coda inesistente fallisce. La politica di una coda
// non si cambia dopo la creazione (createQueue su una coda esistente non fa nulla): per questo, dopo averle create,
// ensureQueues le rilegge con getQueue() e si ferma con un messaggio chiaro se una coda esistente è diversa da quella
// dichiarata. Solo le code: nessuna pianificazione.

const EXPECTED_NAMES = [
  'billing.sync',
  'billing.events.retry',
  'billing.sweep',
  'shops.purge',
  'shops.closeInactiveTrials',
  'email.send',
  'modules.trialReminders',
  'invoicing.sdi',
  'invoicing.pollStatus',
  'exports.build',
  'exports.cleanup',
  'audit.redactIps',
  'auth.cleanupLoginFailures',
];

const byName = (name: string): QueueDefinition | undefined => QUEUES.find((queue) => queue.name === name);

type StoredQueue = { name: string; policy: string; retryLimit: number; retryBackoff: boolean };

/** Un pg-boss finto con le sole operazioni sulle code: le code create si ricordano come le salverebbe pg-boss. */
function fakeBoss(existing: StoredQueue[] = []) {
  const stored = new Map(existing.map((queue) => [queue.name, queue]));
  return {
    stored,
    createQueue: vi.fn(
      async (
        name: string,
        options: { policy?: string; retryLimit?: number; retryBackoff?: boolean } = {},
      ): Promise<void> => {
        // Come pg-boss 12: su una coda esistente non fa nulla.
        if (stored.has(name)) return;
        stored.set(name, {
          name,
          policy: options.policy ?? 'standard',
          retryLimit: options.retryLimit ?? 2,
          retryBackoff: options.retryBackoff ?? false,
        });
      },
    ),
    getQueue: vi.fn(async (name: string) => stored.get(name) ?? null),
    schedule: vi.fn(),
  };
}

async function configError(promise: Promise<unknown>): Promise<QueueConfigError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(QueueConfigError);
    return error as QueueConfigError;
  }
  throw new Error('ensureQueues doveva fermarsi');
}

describe('elenco delle code (src/server/jobs/queues.ts)', () => {
  it('FON-003: l’elenco ha le 13 code della fase 0 di 05 §Lavori periodici, ciascuna una volta', () => {
    expect(QUEUES.map((queue) => queue.name).sort()).toEqual([...EXPECTED_NAMES].sort());
  });

  it('BIL-006: billing.sync è singleton (una sola sincronizzazione attiva per cliente)', () => {
    expect(byName('billing.sync')?.policy).toBe('singleton');
  });

  it('BIL-016: invoicing.sdi è singleton, con 5 tentativi e attesa crescente', () => {
    expect(byName('invoicing.sdi')).toMatchObject({ policy: 'singleton', retryLimit: 5, retryBackoff: true });
  });

  it('FON-003: tutte le altre code sono standard, senza tentativi dichiarati', () => {
    for (const queue of QUEUES) {
      if (queue.name === 'billing.sync' || queue.name === 'invoicing.sdi') continue;
      expect(queue.policy, queue.name).toBe('standard');
      expect(queue.retryLimit, queue.name).toBeUndefined();
      expect(queue.retryBackoff, queue.name).toBeUndefined();
    }
  });
});

describe('ensureQueues', () => {
  it('FON-003: crea ogni coda con la sua politica e i suoi tentativi, la rilegge e non pianifica nulla', async () => {
    const boss = fakeBoss();
    await ensureQueues(boss);
    expect(boss.createQueue).toHaveBeenCalledTimes(EXPECTED_NAMES.length);
    expect(boss.createQueue).toHaveBeenCalledWith('billing.sync', expect.objectContaining({ policy: 'singleton' }));
    expect(boss.createQueue).toHaveBeenCalledWith(
      'invoicing.sdi',
      expect.objectContaining({ policy: 'singleton', retryLimit: 5, retryBackoff: true }),
    );
    expect(boss.createQueue).toHaveBeenCalledWith('email.send', expect.objectContaining({ policy: 'standard' }));
    for (const name of EXPECTED_NAMES) expect(boss.getQueue).toHaveBeenCalledWith(name);
    expect([...boss.stored.keys()].sort()).toEqual([...EXPECTED_NAMES].sort());
    expect(boss.schedule).not.toHaveBeenCalled();
  });

  it('FON-003: ripetuta su code già giuste non cambia nulla e non si ferma', async () => {
    const boss = fakeBoss();
    await ensureQueues(boss);
    const before = structuredClone([...boss.stored.values()]);
    await expect(ensureQueues(boss)).resolves.toBeUndefined();
    expect([...boss.stored.values()]).toEqual(before);
  });

  it('BIL-006: con una coda billing.sync esistente creata standard si ferma, nominando la coda, le due politiche e la correzione', async () => {
    const boss = fakeBoss([{ name: 'billing.sync', policy: 'standard', retryLimit: 2, retryBackoff: false }]);
    const error = await configError(ensureQueues(boss));
    expect(error.message).toContain('billing.sync');
    expect(error.message).toContain('standard');
    expect(error.message).toContain('singleton');
    // La correzione: cancellare la coda e ricrearla vuota, a mano (05 §billing.sync).
    expect(error.message).toMatch(/cancella/i);
    // Le altre code sono state create comunque: si ferma solo dopo averle controllate tutte.
    expect(boss.stored.size).toBe(EXPECTED_NAMES.length);
  });

  it('BIL-016: con invoicing.sdi esistente con 2 tentativi si ferma, nominando la coda e i tentativi', async () => {
    const boss = fakeBoss([{ name: 'invoicing.sdi', policy: 'singleton', retryLimit: 2, retryBackoff: true }]);
    const error = await configError(ensureQueues(boss));
    expect(error.message).toContain('invoicing.sdi');
    expect(error.message).toContain('5');
  });

  it('BIL-016: con invoicing.sdi esistente senza attesa crescente si ferma', async () => {
    const boss = fakeBoss([{ name: 'invoicing.sdi', policy: 'singleton', retryLimit: 5, retryBackoff: false }]);
    const error = await configError(ensureQueues(boss));
    expect(error.message).toContain('invoicing.sdi');
  });

  it('FON-003: più code diverse da quelle dichiarate compaiono tutte nello stesso messaggio', async () => {
    const boss = fakeBoss([
      { name: 'billing.sync', policy: 'standard', retryLimit: 2, retryBackoff: false },
      { name: 'email.send', policy: 'singleton', retryLimit: 2, retryBackoff: false },
    ]);
    const error = await configError(ensureQueues(boss));
    expect(error.message).toContain('billing.sync');
    expect(error.message).toContain('email.send');
  });

  it('FON-003: una coda che dopo createQueue non esiste è un errore', async () => {
    const boss = fakeBoss();
    boss.getQueue.mockImplementation(async (name: string) =>
      name === 'email.send' ? null : (boss.stored.get(name) ?? null),
    );
    const error = await configError(ensureQueues(boss));
    expect(error.message).toContain('email.send');
  });

  it('FON-003: su una coda standard i tentativi salvati da pg-boss non contano (nessun tentativo dichiarato)', async () => {
    const boss = fakeBoss([{ name: 'email.send', policy: 'standard', retryLimit: 7, retryBackoff: true }]);
    await expect(ensureQueues(boss)).resolves.toBeUndefined();
  });
});
