import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from '@/instrumentation';

// Valori di prova riconoscibili, nessuno è un segreto vero.
const key = (byte: number) => Buffer.alloc(32, byte).toString('base64');

const validAppEnv: Record<string, string> = {
  NODE_ENV: 'development',
  APP_ENV: 'dev',
  PUBLIC_BASE_DOMAIN: 'localhost',
  DATABASE_URL: 'postgres://app_user:VALORE-PROVA-PW-USER@localhost:5432/app',
  DATABASE_JOBS_URL: 'postgres://app_jobs:VALORE-PROVA-PW-JOBS@localhost:5432/app',
  BETTER_AUTH_SECRET: 'VALORE-PROVA-BETTER-AUTH-0123456789abcdef',
  JOB_PAYLOAD_KEY: key(1),
  SHOP_SECRETS_KEY: key(2),
  STRIPE_SECRET_KEY: 'placeholder-stripe-secret',
  STRIPE_WEBHOOK_SECRET: 'placeholder-stripe-webhook',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'bucket-di-prova',
  S3_ACCESS_KEY_ID: 'VALORE-PROVA-S3-ACCESS',
  S3_SECRET_ACCESS_KEY: 'VALORE-PROVA-S3-SECRET-123456',
  EMAIL_WEBHOOK_TOKEN: 'VALORE-PROVA-EMAIL-WEBHOOK-0123456789',
  SENTRY_DSN: 'placeholder-sentry-dsn',
  HEALTH_TOKEN: 'VALORE-PROVA-HEALTH-TOKEN',
  ADMIN_ALERT_EMAIL: 'avvisi@example.com',
};

class ExitCalled extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let output: string[];

/** Imposta un ambiente controllato: le variabili dell'app, più quelle date, meno quelle a undefined. */
function setEnv(overrides: Record<string, string | undefined>) {
  for (const name of Object.keys(validAppEnv)) vi.stubEnv(name, validAppEnv[name]);
  vi.stubEnv('DATABASE_OWNER_URL', undefined);
  vi.stubEnv('NEXT_PHASE', undefined);
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  for (const [name, value] of Object.entries(overrides)) vi.stubEnv(name, value);
}

async function runRegister(): Promise<ExitCalled | undefined> {
  try {
    await register();
    return undefined;
  } catch (error) {
    if (error instanceof ExitCalled) return error;
    throw error;
  }
}

beforeEach(() => {
  output = [];
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("avvio dell'app (register in src/instrumentation.ts)", () => {
  it('FON-002: senza DATABASE_URL termina con codice 1 e scrive il nome della variabile, senza valori', async () => {
    setEnv({ DATABASE_URL: undefined });
    const exit = await runRegister();
    expect(exit?.code).toBe(1);
    const text = output.join('\n');
    expect(text).toContain('DATABASE_URL');
    for (const value of Object.values(validAppEnv)) {
      if (value.length >= 8) expect(text).not.toContain(value);
    }
  });

  it('FON-002: con DATABASE_OWNER_URL presente termina con errore', async () => {
    const owner = 'postgres://app_owner:VALORE-PROVA-PW-OWNER@localhost:5432/app';
    setEnv({ DATABASE_OWNER_URL: owner });
    const exit = await runRegister();
    expect(exit?.code).toBe(1);
    const text = output.join('\n');
    expect(text).toContain('DATABASE_OWNER_URL');
    expect(text).not.toContain(owner);
  });

  it('FON-002: con un ambiente valido non termina il processo', async () => {
    setEnv({});
    expect(await runRegister()).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('FON-002: durante next build (NEXT_PHASE = phase-production-build) salta la validazione', async () => {
    setEnv({ DATABASE_URL: undefined, NEXT_PHASE: 'phase-production-build' });
    expect(await runRegister()).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
