// Schemi delle variabili d'ambiente, uno per processo (specs/01-fondamenta.md, §Variabili d'ambiente).
// Ogni processo valida il proprio ambiente all'avvio: app in src/instrumentation.ts, worker, migrate
// e CLI come prima istruzione. Gli errori riportano solo i nomi delle variabili, mai i valori.
import { z } from 'zod';

/** Errore di validazione dell'ambiente: elenca le variabili mancanti o non valide, senza valori. */
export class EnvError extends Error {
  constructor(
    readonly variables: string[],
    readonly details: Record<string, 'mancante' | 'non valida' | 'vietata'>,
  ) {
    const list = variables.map((name) => `${name} (${details[name]})`).join(', ');
    super(`Variabili d'ambiente mancanti o non valide: ${list}`);
    this.name = 'EnvError';
  }
}

/**
 * Valore segnaposto (`placeholder…`, es. `placeholder-stripe`): ammesso in ogni ambiente, server compresi,
 * nelle sole variabili di Stripe, Sentry, email e fornitore SDI, finché i compiti che le usano non lo
 * sostituiscono (specs/README.md). Deve iniziare con `placeholder`: non basta contenerlo.
 */
export function isPlaceholder(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith('placeholder');
}

type Env = Record<string, string | undefined>;

// --- Tipi di valore ---------------------------------------------------------------------------

const text = z.string().min(1);

const url = z.string().refine((value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
});

const postgresUrl = z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') && parsed.hostname !== '';
  } catch {
    return false;
  }
});

const email = z.email();

/** Chiave di 32 byte in base64 (AES-256-GCM). */
const key32 = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/)
  .refine((value) => Buffer.from(value, 'base64').length === 32);

const secret32 = z.string().min(32);

const stripeSecretKey = z
  .string()
  .refine((value) => value.startsWith('sk_test_') || value.startsWith('sk_live_') || isPlaceholder(value));

const stripeWebhookSecret = z.string().refine((value) => value.startsWith('whsec_') || isPlaceholder(value));

/** Un segnaposto, oppure un valore valido per `schema`: per le variabili che specs/README.md elenca. */
const orPlaceholder = (schema: z.ZodType<string>) =>
  z.string().refine((value) => isPlaceholder(value) || schema.safeParse(value).success);

const sentryDsn = orPlaceholder(url);

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

// --- Gruppi di variabili ----------------------------------------------------------------------

const common = {
  NODE_ENV: z.enum(['development', 'test', 'production']),
  APP_ENV: z.enum(['dev', 'test', 'prod']),
  PUBLIC_BASE_DOMAIN: text,
  APP_VERSION: text.optional(),
};

const s3 = {
  S3_ENDPOINT: url,
  S3_REGION: text,
  S3_BUCKET: text,
  S3_ACCESS_KEY_ID: text,
  S3_SECRET_ACCESS_KEY: text,
};

const appShape = {
  ...common,
  ...s3,
  DATABASE_URL: postgresUrl,
  DATABASE_JOBS_URL: postgresUrl,
  BETTER_AUTH_SECRET: secret32,
  JOB_PAYLOAD_KEY: key32,
  SHOP_SECRETS_KEY: key32,
  STRIPE_SECRET_KEY: stripeSecretKey,
  STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
  STRIPE_PORTAL_CONFIGURATION_ID: text.optional(),
  EMAIL_WEBHOOK_TOKEN: secret32,
  SENTRY_DSN: sentryDsn,
  HEALTH_TOKEN: text,
  ADMIN_ALERT_EMAIL: email,
};

const workerShape = {
  ...common,
  ...s3,
  DATABASE_URL: postgresUrl,
  DATABASE_JOBS_URL: postgresUrl,
  JOB_PAYLOAD_KEY: key32,
  SHOP_SECRETS_KEY: key32,
  STRIPE_SECRET_KEY: stripeSecretKey,
  SDI_PROVIDER: text,
  SDI_API_KEY: text.optional(),
  SDI_API_URL: orPlaceholder(url).optional(),
  EMAIL_API_KEY: text,
  EMAIL_FROM: orPlaceholder(email),
  SENTRY_DSN: sentryDsn,
  ADMIN_ALERT_EMAIL: email,
};

const cliShape = {
  ...common,
  ...s3,
  DATABASE_OWNER_URL: postgresUrl,
  ADMIN_ALERT_EMAIL: email,
  DATABASE_JOBS_URL: postgresUrl.optional(),
  ISOLATION_APP_DATABASE_URL: postgresUrl.optional(),
  // Le chiavi Stripe le controllano solo i comandi Stripe (sk_test_, oppure sk_live_ con --live), che le
  // ricevono intatte: un valore sbagliato non ferma migrate né gli altri comandi (01 §Variabili d'ambiente).
  STRIPE_SECRET_KEY: text.optional(),
  STRIPE_LIVE_SECRET_KEY: text.optional(),
  STRIPE_TEST_CLOCK_SETUP: flag.optional(),
};

type Shape = Record<string, z.ZodType>;
type Parsed<S extends Shape> = { [K in keyof S]: z.output<S[K]> };
type WithVersion<T> = Omit<T, 'APP_VERSION'> & { APP_VERSION: string };

// --- Validazione ------------------------------------------------------------------------------

class Problems {
  readonly details: Record<string, 'mancante' | 'non valida' | 'vietata'> = {};
  add(name: string, kind: 'mancante' | 'non valida' | 'vietata') {
    this.details[name] ??= kind;
  }
  has(name: string) {
    return name in this.details;
  }
  throwIfAny() {
    const names = Object.keys(this.details);
    if (names.length > 0) throw new EnvError(names, this.details);
  }
}

/** Una variabile presente ma vuota vale come mancante. */
const read = (env: Env, name: string) => {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
};

/**
 * Valida ogni variabile da sola, così l'errore elenca tutte le variabili sbagliate e non solo la
 * prima; poi esegue i controlli fra variabili. Le variabili non elencate nello schema si ignorano.
 */
function parseShape<S extends Shape>(env: Env, shape: S, problems: Problems): Parsed<S> {
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(shape)) {
    const value = read(env, name);
    const result = schema.safeParse(value);
    if (result.success) {
      if (result.data !== undefined) out[name] = result.data;
    } else {
      problems.add(name, value === undefined ? 'mancante' : 'non valida');
    }
  }
  return out as Parsed<S>;
}

/** APP_VERSION: obbligatoria in prod, predefinita `dev` negli altri ambienti. */
function resolveVersion(env: Env, problems: Problems): string {
  const version = read(env, 'APP_VERSION');
  if (version !== undefined) return version;
  if (read(env, 'APP_ENV') === 'prod') problems.add('APP_VERSION', 'mancante');
  return 'dev';
}

/** App e worker rifiutano DATABASE_OWNER_URL anche vuota: la ricevono comunque (FON-002). */
function forbidOwner(env: Env, problems: Problems) {
  if (env.DATABASE_OWNER_URL !== undefined) problems.add('DATABASE_OWNER_URL', 'vietata');
}

function distinctKeys(env: Env, problems: Problems) {
  if (problems.has('JOB_PAYLOAD_KEY') || problems.has('SHOP_SECRETS_KEY')) return;
  if (read(env, 'JOB_PAYLOAD_KEY') === read(env, 'SHOP_SECRETS_KEY')) problems.add('SHOP_SECRETS_KEY', 'non valida');
}

export type AppEnv = WithVersion<Parsed<typeof appShape>>;
export type WorkerEnv = WithVersion<Parsed<typeof workerShape>>;
export type CliEnv = WithVersion<Parsed<typeof cliShape>>;
export type MigrateEnv = CliEnv;

/** Ambiente dell'app (Next.js). Rifiuta DATABASE_OWNER_URL. */
export function parseAppEnv(env: Env): AppEnv {
  const problems = new Problems();
  forbidOwner(env, problems);
  const parsed = parseShape(env, appShape, problems);
  const APP_VERSION = resolveVersion(env, problems);
  distinctKeys(env, problems);
  problems.throwIfAny();
  return { ...parsed, APP_VERSION };
}

/** Ambiente del worker. Rifiuta DATABASE_OWNER_URL; con un fornitore SDI vero servono chiave e indirizzo. */
export function parseWorkerEnv(env: Env): WorkerEnv {
  const problems = new Problems();
  forbidOwner(env, problems);
  const parsed = parseShape(env, workerShape, problems);
  const APP_VERSION = resolveVersion(env, problems);
  distinctKeys(env, problems);
  const provider = read(env, 'SDI_PROVIDER');
  if (provider !== undefined && provider !== 'fake') {
    if (read(env, 'SDI_API_KEY') === undefined) problems.add('SDI_API_KEY', 'mancante');
    if (read(env, 'SDI_API_URL') === undefined) problems.add('SDI_API_URL', 'mancante');
  }
  problems.throwIfAny();
  return { ...parsed, APP_VERSION };
}

/** Ambiente del CLI (`dist/cli.js`) e degli script con le credenziali del proprietario. */
export function parseCliEnv(env: Env): CliEnv {
  const problems = new Problems();
  const parsed = parseShape(env, cliShape, problems);
  const APP_VERSION = resolveVersion(env, problems);
  problems.throwIfAny();
  return { ...parsed, APP_VERSION };
}

/** Ambiente di migrate: stesse variabili del CLI (colonna migrate/cli di 01). */
export function parseMigrateEnv(env: Env): MigrateEnv {
  return parseCliEnv(env);
}
