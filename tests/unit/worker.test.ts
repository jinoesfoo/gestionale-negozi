import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWorker } from '@/worker';
import { recognizableValues, validWorkerEnv, without } from '../fixtures/env';

// FON-002 per il worker (01 §Variabili d'ambiente, FON-T06): src/worker.ts valida lo schema del worker come prima
// istruzione; senza una variabile obbligatoria, o con DATABASE_OWNER_URL presente (anche vuota), termina con 1 e ne
// scrive il nome, senza valori e senza avviare pg-boss. Con un ambiente valido si collega alla coda come app_jobs
// (DATABASE_JOBS_URL) e resta in attesa (FON-T07b; FON-T10 lo sostituisce con lo scheletro completo).

const boss = vi.hoisted(() => ({
  on: vi.fn(),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
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

beforeEach(() => {
  output = [];
  boss.on.mockClear();
  boss.start.mockClear();
  boss.stop.mockClear();
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

  it('FON-002: con un ambiente valido si collega alla coda come app_jobs (DATABASE_JOBS_URL) e non termina', async () => {
    const env = validWorkerEnv();
    const { worker, exit } = await start(env);
    expect(exit).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(createWorkerBoss).toHaveBeenCalledWith(env.DATABASE_JOBS_URL);
    expect(boss.start).toHaveBeenCalledTimes(1);

    // Un errore di pg-boss non fa cadere il processo: c'è un ascoltatore, che scrive senza valori.
    const listener = boss.on.mock.calls.find(([event]) => event === 'error')?.[1] as
      ((error: Error) => void) | undefined;
    expect(listener).toBeTypeOf('function');
    listener?.(new Error('errore di prova della coda'));
    for (const value of recognizableValues(env)) expect(output.join('\n')).not.toContain(value);

    // Arresto: ferma pg-boss.
    await worker?.stop();
    expect(boss.stop).toHaveBeenCalledTimes(1);
  });
});
