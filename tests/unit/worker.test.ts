import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUES } from '@/server/jobs/queues';
import { WORKER_STOP_TIMEOUT_MS, main, startWorker, type WorkerProcess } from '@/worker';
import { recognizableValues, validWorkerEnv, without } from '../fixtures/env';

// L'avvio del worker (01 FON-T06 e FON-T10). src/worker.ts valida lo schema del worker come prima istruzione; senza
// una variabile obbligatoria, o con DATABASE_OWNER_URL presente (anche vuota), termina con 1 e ne scrive il nome, senza
// valori e senza avviare pg-boss (FON-002). Con un ambiente valido si collega alla coda come app_jobs
// (DATABASE_JOBS_URL), crea e controlla le code con ensureQueues() e registra i gestori dei lavori; se una coda
// esistente ha un'altra politica non parte. I gestori di SIGTERM e SIGINT ci sono già mentre pg-boss si avvia (nota
// (20) di FON-T06: nel container Node è il processo 1 e ignora i segnali senza gestore), e l'arresto è ordinato
// (`stop` con graceful), entro i 10 secondi di `docker stop`.

type StoredQueue = { name: string; policy: string; retryLimit: number; retryBackoff: boolean };

/** Le code come le salverebbe pg-boss, create con l'elenco giusto. */
const correctQueues = (): Map<string, StoredQueue> =>
  new Map(
    QUEUES.map((queue) => [
      queue.name,
      {
        name: queue.name,
        policy: queue.policy,
        retryLimit: queue.retryLimit ?? 2,
        retryBackoff: queue.retryBackoff ?? false,
      },
    ]),
  );

const state = vi.hoisted(() => ({ queues: new Map<string, unknown>() }));
const boss = vi.hoisted(() => ({
  on: vi.fn(),
  start: vi.fn(async (): Promise<unknown> => undefined),
  stop: vi.fn<(options?: unknown) => Promise<undefined>>(async () => undefined),
  createQueue: vi.fn<(name: string, options?: unknown) => Promise<undefined>>(async () => undefined),
  getQueue: vi.fn(async (name: string) => state.queues.get(name) ?? null),
  work: vi.fn<(name: string, ...rest: unknown[]) => Promise<string>>(async () => 'id-del-gestore'),
  schedule: vi.fn(),
}));
const createWorkerBoss = vi.hoisted(() => vi.fn<(url: string) => typeof boss>(() => boss));
// vi.mock sale in cima al file, prima degli import: src/worker.ts riceve il pg-boss finto.
vi.mock('@/server/jobs/boss', () => ({ createWorkerBoss }));

class ExitCalled extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let output: string[];

/** Avvia il worker con l'ambiente dato; restituisce l'uscita chiesta con process.exit, se c'è stata. */
async function start(env: Record<string, string | undefined>) {
  try {
    const worker = await startWorker(env);
    return { worker, exit: undefined };
  } catch (error) {
    if (error instanceof ExitCalled) return { worker: undefined, exit: error };
    throw error;
  }
}

/** Un processo finto per main(): segnali registrati e uscite chieste, senza uscire davvero. */
function fakeProcess() {
  const listeners = new Map<string, (signal: NodeJS.Signals) => void>();
  const exits: number[] = [];
  const proc: WorkerProcess = {
    on: (signal, listener) => {
      listeners.set(signal, listener);
    },
    exit: (code) => {
      exits.push(code);
    },
  };
  return { proc, listeners, exits };
}

beforeEach(() => {
  output = [];
  state.queues = correctQueues();
  for (const fn of Object.values(boss)) fn.mockClear();
  boss.start.mockImplementation(async () => undefined);
  createWorkerBoss.mockClear();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitCalled(code);
  });
  const capture = (...args: unknown[]) => {
    output.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('avvio del worker (src/worker.ts)', () => {
  it('FON-002: senza DATABASE_URL termina con codice 1 e scrive il nome della variabile, senza valori', async () => {
    const env = without(validWorkerEnv(), 'DATABASE_URL');
    const { exit } = await start(env);
    expect(exit?.code).toBe(1);
    const text = output.join('\n');
    expect(text).toContain('DATABASE_URL');
    for (const value of recognizableValues(env)) expect(text).not.toContain(value);
    expect(createWorkerBoss).not.toHaveBeenCalled();
  });

  it('FON-002: con DATABASE_OWNER_URL presente termina con errore, senza scriverne il valore', async () => {
    const owner = 'postgres://app_owner:VALORE-PROVA-PW-OWNER@localhost:5432/app';
    const { exit } = await start({ ...validWorkerEnv(), DATABASE_OWNER_URL: owner });
    expect(exit?.code).toBe(1);
    const text = output.join('\n');
    expect(text).toContain('DATABASE_OWNER_URL');
    expect(text).not.toContain(owner);
    expect(createWorkerBoss).not.toHaveBeenCalled();
  });

  it('FON-002: con DATABASE_OWNER_URL vuota termina comunque con errore', async () => {
    const { exit } = await start({ ...validWorkerEnv(), DATABASE_OWNER_URL: '' });
    expect(exit?.code).toBe(1);
    expect(output.join('\n')).toContain('DATABASE_OWNER_URL');
    expect(createWorkerBoss).not.toHaveBeenCalled();
  });

  it('FON-002: senza EMAIL_PROVIDER termina con 1 e nomina la variabile', async () => {
    const { exit } = await start(without(validWorkerEnv(), 'EMAIL_PROVIDER'));
    expect(exit?.code).toBe(1);
    expect(output.join('\n')).toContain('EMAIL_PROVIDER');
    expect(createWorkerBoss).not.toHaveBeenCalled();
  });

  it('FON-003: con un ambiente valido si collega come app_jobs, crea le code, registra email.send e non termina', async () => {
    const env = validWorkerEnv();
    const { worker, exit } = await start(env);
    expect(exit).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(createWorkerBoss).toHaveBeenCalledWith(env.DATABASE_JOBS_URL);
    expect(boss.start).toHaveBeenCalledTimes(1);

    // ensureQueues dopo l'avvio di pg-boss: ogni coda dell'elenco creata e riletta.
    const created = boss.createQueue.mock.calls.map(([name]) => name).sort();
    expect(created).toEqual(QUEUES.map((queue) => queue.name).sort());
    expect(boss.start.mock.invocationCallOrder[0]).toBeLessThan(boss.createQueue.mock.invocationCallOrder[0]!);

    // I gestori dei lavori dopo le code; nessuna pianificazione.
    expect(boss.work.mock.calls.map(([name]) => name)).toEqual(['email.send']);
    expect(boss.createQueue.mock.invocationCallOrder.at(-1)!).toBeLessThan(boss.work.mock.invocationCallOrder[0]!);
    expect(boss.schedule).not.toHaveBeenCalled();

    // Un errore di pg-boss non fa cadere il processo: c'è un ascoltatore, che scrive senza valori.
    const listener = boss.on.mock.calls.find(([event]) => event === 'error')?.[1] as
      ((error: Error) => void) | undefined;
    expect(listener).toBeTypeOf('function');
    listener?.(new Error('errore di prova della coda'));
    for (const value of recognizableValues(env)) expect(output.join('\n')).not.toContain(value);

    // Arresto ordinato: ferma pg-boss aspettando i lavori in corso, entro i 10 secondi di docker stop.
    await worker?.stop();
    expect(boss.stop).toHaveBeenCalledExactlyOnceWith({ graceful: true, timeout: WORKER_STOP_TIMEOUT_MS });
    expect(WORKER_STOP_TIMEOUT_MS).toBe(8000);
  });

  it('BIL-006: con una coda billing.sync esistente standard termina con 1, nomina la coda e non registra i gestori', async () => {
    state.queues.set('billing.sync', { name: 'billing.sync', policy: 'standard', retryLimit: 2, retryBackoff: false });
    const { exit } = await start(validWorkerEnv());
    expect(exit?.code).toBe(1);
    const text = output.join('\n');
    expect(text).toContain('billing.sync');
    expect(text).toContain('singleton');
    expect(boss.work).not.toHaveBeenCalled();
    // pg-boss si ferma prima dell'uscita.
    expect(boss.stop).toHaveBeenCalled();
  });

  it('FON-003: se pg-boss non si avvia (database che non risponde) termina con 1, senza valori', async () => {
    const env = validWorkerEnv();
    boss.start.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    const { exit } = await start(env);
    expect(exit?.code).toBe(1);
    for (const value of recognizableValues(env)) expect(output.join('\n')).not.toContain(value);
  });
});

describe('processo del worker (main)', () => {
  it('FON-003: i gestori di SIGTERM e SIGINT ci sono già mentre pg-boss si avvia; un SIGTERM arrivato allora ferma pg-boss appena avviato ed esce con 0', async () => {
    let finishStart: () => void = () => {};
    boss.start.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishStart = () => resolve(undefined);
        }),
    );
    const { proc, listeners, exits } = fakeProcess();
    const running = main(validWorkerEnv(), proc);

    // pg-boss si sta avviando: i gestori ci sono già.
    await vi.waitFor(() => expect(boss.start).toHaveBeenCalledTimes(1));
    expect(listeners.has('SIGTERM')).toBe(true);
    expect(listeners.has('SIGINT')).toBe(true);

    listeners.get('SIGTERM')?.('SIGTERM');
    expect(exits).toEqual([]);
    finishStart();
    await running;

    await vi.waitFor(() => expect(exits).toEqual([0]));
    expect(boss.stop).toHaveBeenCalledWith({ graceful: true, timeout: WORKER_STOP_TIMEOUT_MS });
    // Fermato prima di registrare i gestori dei lavori: nessun lavoro preso durante l'arresto.
    expect(boss.work).not.toHaveBeenCalled();
  });

  it('FON-003: un SIGTERM a worker avviato ferma pg-boss ed esce con 0; un secondo segnale non lo ripete', async () => {
    const { proc, listeners, exits } = fakeProcess();
    await main(validWorkerEnv(), proc);
    expect(boss.work).toHaveBeenCalled();

    listeners.get('SIGTERM')?.('SIGTERM');
    listeners.get('SIGINT')?.('SIGINT');
    await vi.waitFor(() => expect(exits).toEqual([0]));
    expect(boss.stop).toHaveBeenCalledTimes(1);
  });

  it('FON-002: con un ambiente non valido esce con 1 senza avviare pg-boss', async () => {
    const { proc, exits } = fakeProcess();
    await main(without(validWorkerEnv(), 'DATABASE_URL'), proc);
    expect(exits).toEqual([1]);
    expect(createWorkerBoss).not.toHaveBeenCalled();
  });
});
