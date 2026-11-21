// Ambienti di prova validi per gli schemi del worker e del CLI (src/config/env.ts), per i test dei punti di ingresso.
// Valori riconoscibili, nessuno è un segreto vero: servono a controllare che i messaggi d'errore riportino i nomi
// delle variabili e mai i valori.

export type TestEnv = Record<string, string>;

const key = (byte: number) => Buffer.alloc(32, byte).toString('base64');

const common: TestEnv = {
  NODE_ENV: 'development',
  APP_ENV: 'dev',
  PUBLIC_BASE_DOMAIN: 'localhost',
};

const s3: TestEnv = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'bucket-di-prova',
  S3_ACCESS_KEY_ID: 'VALORE-PROVA-S3-ACCESS',
  S3_SECRET_ACCESS_KEY: 'VALORE-PROVA-S3-SECRET-123456',
};

/** Ambiente valido del worker (parseWorkerEnv). */
export function validWorkerEnv(): TestEnv {
  return {
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
    EMAIL_PROVIDER: 'fake',
    SENTRY_DSN: 'placeholder-sentry-dsn',
    ADMIN_ALERT_EMAIL: 'avvisi@example.com',
  };
}

/** Ambiente valido del CLI e di migrate (parseCliEnv, parseMigrateEnv). */
export function validCliEnv(): TestEnv {
  return {
    ...common,
    ...s3,
    DATABASE_OWNER_URL: 'postgres://app_owner:VALORE-PROVA-PW-OWNER@localhost:5432/app',
    ADMIN_ALERT_EMAIL: 'avvisi@example.com',
  };
}

/** Una copia dell'ambiente senza la variabile indicata. */
export function without(env: TestEnv, name: string): TestEnv {
  const copy = { ...env };
  delete copy[name];
  return copy;
}

/** I valori dell'ambiente abbastanza lunghi da essere riconoscibili in un messaggio (gli altri, come `dev`, no). */
export function recognizableValues(env: Record<string, string | undefined>): string[] {
  return Object.values(env).filter((value): value is string => value !== undefined && value.length >= 8);
}
