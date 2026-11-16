import { describe, expect, it } from 'vitest';
import { EnvError, isPlaceholder, parseAppEnv, parseCliEnv, parseMigrateEnv, parseWorkerEnv } from '@/config/env';

// Valori di prova riconoscibili: nessuno è un segreto vero. Servono a controllare
// che i messaggi d'errore riportino i nomi delle variabili e mai i valori.
const key = (byte: number) => Buffer.alloc(32, byte).toString('base64');

type Env = Record<string, string | undefined>;

const common: Env = {
  NODE_ENV: 'development',
  APP_ENV: 'dev',
  PUBLIC_BASE_DOMAIN: 'localhost',
};

const s3: Env = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'bucket-di-prova',
  S3_ACCESS_KEY_ID: 'VALORE-PROVA-S3-ACCESS',
  S3_SECRET_ACCESS_KEY: 'VALORE-PROVA-S3-SECRET-123456',
};

const appEnv = (): Env => ({
  ...common,
  ...s3,
  DATABASE_URL: 'postgres://app_user:VALORE-PROVA-PW-USER@localhost:5432/app',
  DATABASE_JOBS_URL: 'postgres://app_jobs:VALORE-PROVA-PW-JOBS@localhost:5432/app',
  BETTER_AUTH_SECRET: 'VALORE-PROVA-BETTER-AUTH-0123456789abcdef',
  JOB_PAYLOAD_KEY: key(1),
  SHOP_SECRETS_KEY: key(2),
  STRIPE_SECRET_KEY: 'placeholder-stripe-secret',
  STRIPE_WEBHOOK_SECRET: 'placeholder-stripe-webhook',
  EMAIL_WEBHOOK_TOKEN: 'VALORE-PROVA-EMAIL-WEBHOOK-0123456789',
  SENTRY_DSN: 'placeholder-sentry-dsn',
  HEALTH_TOKEN: 'VALORE-PROVA-HEALTH-TOKEN',
  ADMIN_ALERT_EMAIL: 'avvisi@example.com',
});

const workerEnv = (): Env => ({
  ...common,
  ...s3,
  DATABASE_URL: 'postgres://app_worker:VALORE-PROVA-PW-WORKER@localhost:5432/app',
  DATABASE_JOBS_URL: 'postgres://app_jobs:VALORE-PROVA-PW-JOBS@localhost:5432/app',
  JOB_PAYLOAD_KEY: key(1),
  SHOP_SECRETS_KEY: key(2),
  STRIPE_SECRET_KEY: 'placeholder-stripe-secret',
  SDI_PROVIDER: 'fake',
  EMAIL_API_KEY: 'VALORE-PROVA-EMAIL-API-KEY',
  EMAIL_FROM: 'noreply@example.com',
  SENTRY_DSN: 'placeholder-sentry-dsn',
  ADMIN_ALERT_EMAIL: 'avvisi@example.com',
});

const cliEnv = (): Env => ({
  ...common,
  ...s3,
  DATABASE_OWNER_URL: 'postgres://app_owner:VALORE-PROVA-PW-OWNER@localhost:5432/app',
  ADMIN_ALERT_EMAIL: 'avvisi@example.com',
});

/** Esegue il parser e restituisce l'errore, che deve essere un EnvError. */
function envError(parse: (env: Env) => unknown, env: Env): EnvError {
  try {
    parse(env);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return error as EnvError;
  }
  throw new Error('il parser doveva rifiutare questo ambiente');
}

/** Nessun valore dell'ambiente (abbastanza lungo da essere riconoscibile) compare nel messaggio. */
function expectNoValues(message: string, env: Env) {
  for (const value of Object.values(env)) {
    if (value && value.length >= 8) expect(message).not.toContain(value);
  }
}

describe("schema dell'app", () => {
  it('FON-002: un ambiente completo è accettato e APP_VERSION vale dev in sviluppo', () => {
    const env = parseAppEnv(appEnv());
    expect(env.DATABASE_URL).toBe(appEnv().DATABASE_URL);
    expect(env.APP_VERSION).toBe('dev');
  });

  it("FON-002: senza DATABASE_URL rifiuta l'avvio con il nome della variabile e senza valori", () => {
    const env = appEnv();
    delete env.DATABASE_URL;
    const error = envError(parseAppEnv, env);
    expect(error.variables).toContain('DATABASE_URL');
    expect(error.message).toContain('DATABASE_URL');
    expectNoValues(error.message, env);
  });

  it('FON-002: una variabile presente ma vuota vale come mancante', () => {
    const error = envError(parseAppEnv, { ...appEnv(), DATABASE_URL: '' });
    expect(error.variables).toContain('DATABASE_URL');
  });

  it('FON-002: DATABASE_URL malformata è rifiutata senza stampare il valore', () => {
    const env = { ...appEnv(), DATABASE_URL: 'non-un-indirizzo-VALORE-PROVA-MALFORMATO' };
    const error = envError(parseAppEnv, env);
    expect(error.variables).toEqual(['DATABASE_URL']);
    expectNoValues(error.message, env);
  });

  it("FON-002: con DATABASE_OWNER_URL presente l'app rifiuta l'avvio", () => {
    const env = {
      ...appEnv(),
      DATABASE_OWNER_URL: 'postgres://app_owner:VALORE-PROVA-PW-OWNER@localhost:5432/app',
    };
    const error = envError(parseAppEnv, env);
    expect(error.variables).toContain('DATABASE_OWNER_URL');
    expect(error.message).toContain('DATABASE_OWNER_URL');
    expectNoValues(error.message, env);
  });

  it('FON-002: elenca tutte le variabili mancanti, non solo la prima', () => {
    const env = appEnv();
    delete env.DATABASE_URL;
    delete env.HEALTH_TOKEN;
    const error = envError(parseAppEnv, env);
    expect(error.variables).toEqual(expect.arrayContaining(['DATABASE_URL', 'HEALTH_TOKEN']));
  });

  it('FON-002: APP_VERSION è obbligatoria in prod e facoltativa in test', () => {
    const prod = { ...appEnv(), NODE_ENV: 'production', APP_ENV: 'prod' };
    expect(envError(parseAppEnv, prod).variables).toContain('APP_VERSION');
    expect(parseAppEnv({ ...prod, APP_VERSION: 'a'.repeat(40) }).APP_VERSION).toBe('a'.repeat(40));
    expect(parseAppEnv({ ...appEnv(), NODE_ENV: 'test', APP_ENV: 'test' }).APP_VERSION).toBe('dev');
  });

  it('FON-002: APP_ENV accetta solo dev, test e prod', () => {
    expect(envError(parseAppEnv, { ...appEnv(), APP_ENV: 'staging' }).variables).toContain('APP_ENV');
  });

  it('FON-002: JOB_PAYLOAD_KEY e SHOP_SECRETS_KEY devono essere 32 byte in base64 e diverse', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    expect(envError(parseAppEnv, { ...appEnv(), JOB_PAYLOAD_KEY: short }).variables).toContain('JOB_PAYLOAD_KEY');
    expect(envError(parseAppEnv, { ...appEnv(), SHOP_SECRETS_KEY: '%%%non-base64%%%' }).variables).toContain(
      'SHOP_SECRETS_KEY',
    );
    const same = envError(parseAppEnv, { ...appEnv(), SHOP_SECRETS_KEY: key(1) });
    expect(same.variables).toContain('SHOP_SECRETS_KEY');
    expectNoValues(same.message, appEnv());
  });

  it('FON-002: BETTER_AUTH_SECRET ed EMAIL_WEBHOOK_TOKEN richiedono almeno 32 caratteri', () => {
    expect(envError(parseAppEnv, { ...appEnv(), BETTER_AUTH_SECRET: 'x'.repeat(31) }).variables).toContain(
      'BETTER_AUTH_SECRET',
    );
    expect(envError(parseAppEnv, { ...appEnv(), EMAIL_WEBHOOK_TOKEN: 'x'.repeat(31) }).variables).toContain(
      'EMAIL_WEBHOOK_TOKEN',
    );
    expect(() => parseAppEnv({ ...appEnv(), BETTER_AUTH_SECRET: 'x'.repeat(32) })).not.toThrow();
  });

  it('FON-002: STRIPE_SECRET_KEY accetta sk_test_, sk_live_ o un segnaposto', () => {
    for (const ok of ['sk_test_abc', 'sk_live_abc', 'placeholder-stripe']) {
      expect(() => parseAppEnv({ ...appEnv(), STRIPE_SECRET_KEY: ok })).not.toThrow();
    }
    expect(envError(parseAppEnv, { ...appEnv(), STRIPE_SECRET_KEY: 'pk_test_abc' }).variables).toContain(
      'STRIPE_SECRET_KEY',
    );
  });

  it('FON-002: ADMIN_ALERT_EMAIL deve essere un indirizzo email', () => {
    expect(envError(parseAppEnv, { ...appEnv(), ADMIN_ALERT_EMAIL: 'non-una-email' }).variables).toContain(
      'ADMIN_ALERT_EMAIL',
    );
  });

  it('FON-002: STRIPE_PORTAL_CONFIGURATION_ID è facoltativa', () => {
    expect(parseAppEnv(appEnv()).STRIPE_PORTAL_CONFIGURATION_ID).toBeUndefined();
    expect(parseAppEnv({ ...appEnv(), STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_123' }).STRIPE_PORTAL_CONFIGURATION_ID).toBe(
      'bpc_123',
    );
  });
});

describe('schema del worker', () => {
  it('FON-002: un ambiente completo è accettato', () => {
    expect(parseWorkerEnv(workerEnv()).SDI_PROVIDER).toBe('fake');
  });

  it("FON-002: senza DATABASE_URL il worker rifiuta l'avvio con il nome della variabile", () => {
    const env = workerEnv();
    delete env.DATABASE_URL;
    const error = envError(parseWorkerEnv, env);
    expect(error.variables).toContain('DATABASE_URL');
    expectNoValues(error.message, env);
  });

  it("FON-002: con DATABASE_OWNER_URL presente il worker rifiuta l'avvio", () => {
    const env = { ...workerEnv(), DATABASE_OWNER_URL: 'postgres://app_owner:VALORE-PROVA-PW-OWNER@localhost/app' };
    const error = envError(parseWorkerEnv, env);
    expect(error.variables).toContain('DATABASE_OWNER_URL');
    expectNoValues(error.message, env);
  });

  it('FON-002: con un fornitore SDI diverso da fake servono SDI_API_KEY e SDI_API_URL', () => {
    const error = envError(parseWorkerEnv, { ...workerEnv(), SDI_PROVIDER: 'fornitore-vero' });
    expect(error.variables).toEqual(expect.arrayContaining(['SDI_API_KEY', 'SDI_API_URL']));
    expect(() =>
      parseWorkerEnv({
        ...workerEnv(),
        SDI_PROVIDER: 'fornitore-vero',
        SDI_API_KEY: 'VALORE-PROVA-SDI-KEY',
        SDI_API_URL: 'https://sdi.example.com',
      }),
    ).not.toThrow();
  });

  it('FON-002: EMAIL_FROM deve essere un indirizzo email', () => {
    expect(envError(parseWorkerEnv, { ...workerEnv(), EMAIL_FROM: 'mittente' }).variables).toContain('EMAIL_FROM');
  });
});

describe('schema del CLI e di migrate', () => {
  it('FON-002: un ambiente con le sole variabili obbligatorie è accettato', () => {
    const env = parseCliEnv(cliEnv());
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_LIVE_SECRET_KEY).toBeUndefined();
    expect(env.DATABASE_JOBS_URL).toBeUndefined();
    expect(env.ISOLATION_APP_DATABASE_URL).toBeUndefined();
  });

  it("FON-002: senza DATABASE_OWNER_URL il CLI e migrate rifiutano l'avvio con il nome della variabile", () => {
    const env = cliEnv();
    delete env.DATABASE_OWNER_URL;
    for (const parse of [parseCliEnv, parseMigrateEnv]) {
      const error = envError(parse, env);
      expect(error.variables).toContain('DATABASE_OWNER_URL');
      expect(error.message).toContain('DATABASE_OWNER_URL');
      expectNoValues(error.message, env);
    }
  });

  it('FON-002: le variabili facoltative del CLI sono accettate quando ci sono', () => {
    const env = parseCliEnv({
      ...cliEnv(),
      DATABASE_JOBS_URL: 'postgres://app_jobs:VALORE-PROVA-PW-JOBS@localhost:5432/app',
      ISOLATION_APP_DATABASE_URL: 'postgres://app_user:VALORE-PROVA-PW-USER@localhost:5432/app',
      STRIPE_SECRET_KEY: 'sk_test_abc',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_abc',
      STRIPE_TEST_CLOCK_SETUP: 'true',
    });
    expect(env.STRIPE_LIVE_SECRET_KEY).toBe('sk_live_abc');
  });

  it('FON-002: una variabile facoltativa malformata è rifiutata', () => {
    expect(envError(parseCliEnv, { ...cliEnv(), ISOLATION_APP_DATABASE_URL: 'non-un-indirizzo' }).variables).toContain(
      'ISOLATION_APP_DATABASE_URL',
    );
  });
});

describe('segnaposto', () => {
  it('FON-002: isPlaceholder riconosce i valori segnaposto', () => {
    expect(isPlaceholder('placeholder-stripe')).toBe(true);
    expect(isPlaceholder('sk_test_abc')).toBe(false);
    expect(isPlaceholder('')).toBe(false);
    expect(isPlaceholder(undefined)).toBe(false);
  });
});
