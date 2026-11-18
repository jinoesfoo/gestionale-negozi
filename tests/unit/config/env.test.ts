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

/** Chiave di 32 byte in base64 il cui testo inizia con `prefix` (solo lettere: restano caratteri base64). */
const keyStartingWith = (prefix: string) => prefix + 'A'.repeat(43 - prefix.length) + '=';

/**
 * La stessa chiave scritta in un altro modo. Con 32 byte il testo base64 ha 43 caratteri più `=`, e la decodifica
 * ignora gli ultimi 2 bit del 43° carattere: cambiando il più basso dei due, il testo cambia e i byte restano gli stessi.
 */
function sameKeyWrittenDifferently(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const last = alphabet.indexOf(value.charAt(42));
  return value.slice(0, 42) + alphabet.charAt(last ^ 1) + value.slice(43);
}

/**
 * Le variabili di `values` che il parser accetta: messo il loro valore al posto di quello di `base`, uno alla volta,
 * l'ambiente passa, oppure l'errore non le segnala come non valide.
 */
function acceptedValues(parse: (env: Env) => unknown, base: Env, values: Env): string[] {
  return Object.keys(values).filter((name) => {
    try {
      parse({ ...base, [name]: values[name] });
      return true;
    } catch (error) {
      if (!(error instanceof EnvError)) throw error;
      return error.details[name] !== 'non valida';
    }
  });
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

  it('FON-002: DATABASE_URL presente ma vuota vale come mancante', () => {
    const error = envError(parseAppEnv, { ...appEnv(), DATABASE_URL: '' });
    expect(error.variables).toContain('DATABASE_URL');
    expect(error.details.DATABASE_URL).toBe('mancante');
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

  it("FON-002: con DATABASE_OWNER_URL presente ma vuota l'app rifiuta l'avvio", () => {
    const error = envError(parseAppEnv, { ...appEnv(), DATABASE_OWNER_URL: '' });
    expect(error.variables).toContain('DATABASE_OWNER_URL');
    expect(error.details.DATABASE_OWNER_URL).toBe('vietata');
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

  it('FON-002: JOB_PAYLOAD_KEY e SHOP_SECRETS_KEY si confrontano per i byte: la stessa chiave scritta in un altro modo è rifiutata', () => {
    const twin = sameKeyWrittenDifferently(key(1));
    expect(twin).not.toBe(key(1));
    expect(Buffer.from(twin, 'base64').equals(Buffer.from(key(1), 'base64'))).toBe(true);
    const env = { ...appEnv(), JOB_PAYLOAD_KEY: key(1), SHOP_SECRETS_KEY: twin };
    const error = envError(parseAppEnv, env);
    expect(error.details.SHOP_SECRETS_KEY).toBe('non valida');
    expectNoValues(error.message, env);
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

  it("FON-002: con DATABASE_OWNER_URL presente ma vuota il worker rifiuta l'avvio", () => {
    const error = envError(parseWorkerEnv, { ...workerEnv(), DATABASE_OWNER_URL: '' });
    expect(error.variables).toContain('DATABASE_OWNER_URL');
    expect(error.details.DATABASE_OWNER_URL).toBe('vietata');
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

  it('FON-002: JOB_PAYLOAD_KEY e SHOP_SECRETS_KEY devono essere diverse, confrontate per i byte', () => {
    for (const shopKey of [key(1), sameKeyWrittenDifferently(key(1))]) {
      const env = { ...workerEnv(), JOB_PAYLOAD_KEY: key(1), SHOP_SECRETS_KEY: shopKey };
      const error = envError(parseWorkerEnv, env);
      expect(error.details.SHOP_SECRETS_KEY).toBe('non valida');
      expectNoValues(error.message, env);
    }
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

  it('FON-002: ISOLATION_APP_DATABASE_URL malformata è rifiutata dal CLI', () => {
    expect(envError(parseCliEnv, { ...cliEnv(), ISOLATION_APP_DATABASE_URL: 'non-un-indirizzo' }).variables).toContain(
      'ISOLATION_APP_DATABASE_URL',
    );
  });

  // Sui server una variabile facoltativa ancora senza valore si scrive NOME="" # facoltativa, e Compose la
  // passa vuota (01, FON-T01): vuota vale come assente. Solo app e worker rifiutano DATABASE_OWNER_URL vuota.
  it('FON-002: una variabile facoltativa presente ma vuota vale come assente', () => {
    expect(
      parseAppEnv({ ...appEnv(), STRIPE_PORTAL_CONFIGURATION_ID: '' }).STRIPE_PORTAL_CONFIGURATION_ID,
    ).toBeUndefined();
    for (const parse of [parseCliEnv, parseMigrateEnv]) {
      expect(parse({ ...cliEnv(), STRIPE_TEST_CLOCK_SETUP: '' }).STRIPE_TEST_CLOCK_SETUP, parse.name).toBeUndefined();
    }
  });

  it('FON-002: nel CLI e in migrate DATABASE_OWNER_URL vuota vale come mancante', () => {
    for (const parse of [parseCliEnv, parseMigrateEnv]) {
      const error = envError(parse, { ...cliEnv(), DATABASE_OWNER_URL: '' });
      expect(error.details.DATABASE_OWNER_URL, parse.name).toBe('mancante');
    }
  });

  // Le chiavi Stripe le controllano solo i comandi Stripe, che le ricevono intatte (01 §Variabili d'ambiente):
  // nessun valore deve fermare migrate né gli altri comandi, nemmeno un segnaposto o un valore con CAMBIA.
  it('FON-002: STRIPE_SECRET_KEY nel CLI e in migrate è facoltativa e senza controlli, nemmeno su segnaposto e CAMBIA', () => {
    for (const value of [
      'pk_test_VALORE-PROVA',
      'sk_live_VALORE-PROVA',
      'placeholder-stripe',
      'sk_test_CAMBIA',
      'qualsiasi-valore',
    ]) {
      for (const parse of [parseCliEnv, parseMigrateEnv]) {
        const env = { ...cliEnv(), STRIPE_SECRET_KEY: value };
        expect(() => parse(env), `${parse.name}: ${value}`).not.toThrow();
        expect(parse(env).STRIPE_SECRET_KEY).toBe(value);
      }
    }
  });

  it('FON-002: STRIPE_LIVE_SECRET_KEY nel CLI e in migrate è facoltativa e senza controlli, nemmeno su segnaposto e CAMBIA', () => {
    for (const value of ['sk_test_VALORE-PROVA', 'placeholder-stripe-live', 'sk_live_CAMBIA', 'qualsiasi-valore']) {
      for (const parse of [parseCliEnv, parseMigrateEnv]) {
        const env = { ...cliEnv(), STRIPE_LIVE_SECRET_KEY: value };
        expect(() => parse(env), `${parse.name}: ${value}`).not.toThrow();
        expect(parse(env).STRIPE_LIVE_SECRET_KEY).toBe(value);
      }
    }
  });
});

describe('segnaposto', () => {
  it('FON-002: isPlaceholder riconosce i valori segnaposto', () => {
    expect(isPlaceholder('placeholder-stripe')).toBe(true);
    expect(isPlaceholder('sk_test_abc')).toBe(false);
    expect(isPlaceholder('')).toBe(false);
    expect(isPlaceholder(undefined)).toBe(false);
    // Il segnaposto inizia con placeholder (specs/README.md): non basta contenerlo.
    expect(isPlaceholder('sk_test_placeholder')).toBe(false);
  });

  // specs/README.md e 01 §Variabili d'ambiente: le variabili di Stripe, Sentry, email e fornitore SDI elencate in 01
  // possono avere valori che iniziano con `placeholder`, e lo schema li accetta. EMAIL_WEBHOOK_TOKEN ha un segnaposto
  // di almeno 32 caratteri, la lunghezza che 01 chiede per questa variabile.
  it("FON-002: l'app accetta i segnaposto nelle variabili di Stripe, Sentry ed email", () => {
    expect(() =>
      parseAppEnv({
        ...appEnv(),
        STRIPE_SECRET_KEY: 'placeholder-stripe',
        STRIPE_WEBHOOK_SECRET: 'placeholder-stripe-webhook',
        STRIPE_PORTAL_CONFIGURATION_ID: 'placeholder-stripe-portal',
        EMAIL_WEBHOOK_TOKEN: 'placeholder-email-webhook-0123456789',
        SENTRY_DSN: 'placeholder-sentry',
      }),
    ).not.toThrow();
  });

  it('FON-002: il worker accetta i segnaposto nelle variabili di Stripe, Sentry, email e fornitore SDI', () => {
    expect(() =>
      parseWorkerEnv({
        ...workerEnv(),
        STRIPE_SECRET_KEY: 'placeholder-stripe',
        SDI_PROVIDER: 'placeholder-sdi',
        SDI_API_KEY: 'placeholder-sdi-key',
        SDI_API_URL: 'placeholder-sdi-url',
        EMAIL_API_KEY: 'placeholder-email',
        EMAIL_FROM: 'placeholder-email-from',
        SENTRY_DSN: 'placeholder-sentry',
      }),
    ).not.toThrow();
  });

  // Sui server (NODE_ENV production, APP_ENV test o prod) i segnaposto restano fino ai compiti che li
  // sostituiscono: STRIPE_WEBHOOK_SECRET fino a BIL-T02, le variabili SDI fino a BIL-T11, SENTRY_DSN fino a
  // OPS-T04 (specs/README.md). STRIPE_SECRET_KEY e le email invece sono vere dal primo avvio completo (FON-T07b).
  it("FON-002: negli ambienti dei server app e worker accettano i segnaposto dell'avvio iniziale", () => {
    for (const APP_ENV of ['test', 'prod']) {
      const server = {
        NODE_ENV: 'production',
        APP_ENV,
        APP_VERSION: 'a'.repeat(40),
        STRIPE_SECRET_KEY: 'sk_test_VALORE-PROVA',
      };
      const app = {
        ...appEnv(),
        ...server,
        STRIPE_WEBHOOK_SECRET: 'placeholder-stripe-webhook',
        SENTRY_DSN: 'placeholder-sentry',
      };
      expect(() => parseAppEnv(app), `app, APP_ENV=${APP_ENV}`).not.toThrow();
      const worker = {
        ...workerEnv(),
        ...server,
        // Arriva con FON-T10 (fake rifiutato in prod); sui server vale brevo. Lo schema di FON-T01 la ignora.
        EMAIL_PROVIDER: 'brevo',
        SDI_PROVIDER: 'placeholder-sdi',
        SDI_API_KEY: 'placeholder-sdi-key',
        SDI_API_URL: 'placeholder-sdi-url',
        SENTRY_DSN: 'placeholder-sentry',
      };
      expect(() => parseWorkerEnv(worker), `worker, APP_ENV=${APP_ENV}`).not.toThrow();
    }
  });

  // Anche un valore che contiene la parola placeholder senza iniziare con lei non è un segnaposto.
  it('FON-002: un valore che non inizia con placeholder resta soggetto al controllo del formato', () => {
    const sdi = { ...workerEnv(), SDI_PROVIDER: 'fornitore-vero', SDI_API_KEY: 'VALORE-PROVA-SDI-KEY' };
    for (const bad of ['non-un-indirizzo', 'sdi-placeholder']) {
      expect(envError(parseWorkerEnv, { ...sdi, SDI_API_URL: bad }).variables, bad).toContain('SDI_API_URL');
    }
    for (const bad of ['non-una-email', 'mittente-placeholder']) {
      expect(envError(parseWorkerEnv, { ...workerEnv(), EMAIL_FROM: bad }).variables, bad).toContain('EMAIL_FROM');
    }
    for (const bad of ['non-un-dsn', 'dsn-placeholder']) {
      expect(envError(parseWorkerEnv, { ...workerEnv(), SENTRY_DSN: bad }).variables, bad).toContain('SENTRY_DSN');
      expect(envError(parseAppEnv, { ...appEnv(), SENTRY_DSN: bad }).variables, bad).toContain('SENTRY_DSN');
    }
  });

  // 01 §Variabili d'ambiente: un segnaposto vale solo nelle variabili di Stripe, Sentry, email e fornitore SDI elencate
  // lì, e prende il posto del formato, non della lunghezza minima: EMAIL_WEBHOOK_TOKEN resta di almeno 32 caratteri
  // anche da segnaposto, e STRIPE_TEST_CLOCK_SETUP vale solo true o false. ADMIN_ALERT_EMAIL, il destinatario degli
  // avvisi, non è fra quelle variabili.
  it('FON-002: un segnaposto vale solo nelle variabili elencate in 01: non in ADMIN_ALERT_EMAIL né nelle altre, né in un token corto o in un interruttore', () => {
    // Valori con il formato giusto per la loro variabile: li può rifiutare solo la regola sui segnaposto, come prova il
    // controllo con valoreprova (stessa lunghezza, solo lettere) al posto di placeholder.
    const common: Env = {
      APP_VERSION: 'placeholder-versione',
      PUBLIC_BASE_DOMAIN: 'placeholder.example',
      S3_ENDPOINT: 'placeholder://s3',
      S3_REGION: 'placeholder-region',
      S3_BUCKET: 'placeholder-bucket',
      S3_ACCESS_KEY_ID: 'placeholder-s3-access',
      S3_SECRET_ACCESS_KEY: 'placeholder-s3-secret',
      ADMIN_ALERT_EMAIL: 'placeholder@example.com',
    };
    const keys: Env = {
      JOB_PAYLOAD_KEY: keyStartingWith('placeholder'),
      SHOP_SECRETS_KEY: keyStartingWith('placeholder'),
    };
    // Valori che rifiuta già il formato: gli indirizzi PostgreSQL, un token corto anche fra le variabili elencate e un
    // interruttore.
    const placeholder = 'placeholder-VALORE-PROVA';
    const cases: [(env: Env) => unknown, Env, Env, Env][] = [
      [
        parseAppEnv,
        appEnv(),
        {
          ...common,
          ...keys,
          BETTER_AUTH_SECRET: 'placeholder-better-auth-0123456789abcdef',
          HEALTH_TOKEN: 'placeholder-health-token',
        },
        { DATABASE_URL: placeholder, DATABASE_JOBS_URL: placeholder, EMAIL_WEBHOOK_TOKEN: placeholder },
      ],
      [
        parseWorkerEnv,
        workerEnv(),
        { ...common, ...keys },
        { DATABASE_URL: placeholder, DATABASE_JOBS_URL: placeholder },
      ],
      [
        parseCliEnv,
        cliEnv(),
        common,
        {
          DATABASE_OWNER_URL: placeholder,
          DATABASE_JOBS_URL: placeholder,
          ISOLATION_APP_DATABASE_URL: placeholder,
          STRIPE_TEST_CLOCK_SETUP: placeholder,
        },
      ],
    ];
    const withoutPlaceholder = (values: Env): Env =>
      Object.fromEntries(
        Object.entries(values).map(([name, value]) => [name, value?.replace(/^placeholder/, 'valoreprova')]),
      );
    for (const [parse, base, valid, invalid] of cases) {
      expect(
        acceptedValues(parse, base, withoutPlaceholder(valid)),
        `${parse.name}: controllo con valoreprova`,
      ).toEqual(Object.keys(valid));
      expect(acceptedValues(parse, base, { ...valid, ...invalid }), parse.name).toEqual([]);
    }
  });
});

// 01 §Variabili d'ambiente: negli esempi dei server i valori da sostituire contengono CAMBIA, e un valore che contiene
// ancora CAMBIA non è valido, anche quando il formato della variabile lo ammetterebbe. Ogni valore qui sotto ha il
// formato giusto per la sua variabile (lo prova il controllo con VALORE al posto di CAMBIA), così lo può rifiutare
// solo la regola su CAMBIA. Le chiavi Stripe del CLI non hanno controlli: le prova lo schema del CLI e di migrate.
describe('valori da sostituire (CAMBIA)', () => {
  const common: Env = {
    APP_VERSION: 'CAMBIA',
    PUBLIC_BASE_DOMAIN: 'CAMBIA.example',
    S3_ENDPOINT: 'https://s3.CAMBIA.example',
    S3_REGION: 'CAMBIA',
    S3_BUCKET: 'CAMBIA',
    S3_ACCESS_KEY_ID: 'CAMBIA',
    S3_SECRET_ACCESS_KEY: 'CAMBIA',
    ADMIN_ALERT_EMAIL: 'avvisi@CAMBIA.example',
  };
  const app: Env = {
    ...common,
    DATABASE_URL: 'postgres://app_user:CAMBIA-password-app-user@localhost:5432/app',
    DATABASE_JOBS_URL: 'postgres://app_jobs:CAMBIA-password-app-jobs@localhost:5432/app',
    BETTER_AUTH_SECRET: 'CAMBIA-almeno-32-caratteri-casuali',
    JOB_PAYLOAD_KEY: keyStartingWith('CAMBIA'),
    SHOP_SECRETS_KEY: keyStartingWith('CAMBIA'),
    STRIPE_SECRET_KEY: 'sk_test_CAMBIA',
    STRIPE_WEBHOOK_SECRET: 'whsec_CAMBIA',
    STRIPE_PORTAL_CONFIGURATION_ID: 'CAMBIA',
    EMAIL_WEBHOOK_TOKEN: 'CAMBIA-almeno-32-caratteri-casuali',
    SENTRY_DSN: 'https://CAMBIA@sentry.example/1',
    HEALTH_TOKEN: 'CAMBIA',
  };
  const worker: Env = {
    ...common,
    DATABASE_URL: 'postgres://app_worker:CAMBIA-password-app-worker@localhost:5432/app',
    DATABASE_JOBS_URL: 'postgres://app_jobs:CAMBIA-password-app-jobs@localhost:5432/app',
    JOB_PAYLOAD_KEY: keyStartingWith('CAMBIA'),
    SHOP_SECRETS_KEY: keyStartingWith('CAMBIA'),
    STRIPE_SECRET_KEY: 'sk_test_CAMBIA',
    SDI_PROVIDER: 'CAMBIA',
    SDI_API_KEY: 'CAMBIA',
    SDI_API_URL: 'https://sdi.CAMBIA.example',
    EMAIL_API_KEY: 'CAMBIA',
    EMAIL_FROM: 'noreply@CAMBIA.example',
    SENTRY_DSN: 'https://CAMBIA@sentry.example/1',
  };
  const cli: Env = {
    ...common,
    DATABASE_OWNER_URL: 'postgres://app_owner:CAMBIA-password-app-owner@localhost:5432/app',
    DATABASE_JOBS_URL: 'postgres://app_jobs:CAMBIA-password-app-jobs@localhost:5432/app',
    ISOLATION_APP_DATABASE_URL: 'postgres://app_user:CAMBIA-password-app-user@localhost:5432/app',
  };
  // Con un fornitore SDI vero, così SDI_API_KEY e SDI_API_URL sono richieste e il loro formato conta.
  const workerWithSdi = (): Env => ({
    ...workerEnv(),
    SDI_PROVIDER: 'fornitore-vero',
    SDI_API_KEY: 'VALORE-PROVA-SDI-KEY',
    SDI_API_URL: 'https://sdi.example.com',
  });
  const withoutCambia = (values: Env): Env =>
    Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value?.replaceAll('CAMBIA', 'VALORE')]));

  const cases: [string, (env: Env) => unknown, () => Env, Env][] = [
    ["l'app", parseAppEnv, appEnv, app],
    ['il worker', parseWorkerEnv, workerWithSdi, worker],
    ['il CLI', parseCliEnv, cliEnv, cli],
    ['migrate', parseMigrateEnv, cliEnv, cli],
  ];
  it.each(cases)(
    'FON-002: %s rifiuta un valore che contiene ancora CAMBIA, anche con il formato giusto',
    (_, parse, base, values) => {
      const names = Object.keys(values);
      expect(acceptedValues(parse, base(), withoutCambia(values)), 'controllo: con VALORE al posto di CAMBIA').toEqual(
        names,
      );
      expect(acceptedValues(parse, base(), values)).toEqual([]);
    },
  );

  it('FON-002: cambia in minuscolo resta valido, perché può stare in un dominio o in un indirizzo veri', () => {
    const domain = 'cambiavalute.example';
    const email = 'avvisi@cambiamenti.example';
    expect(() => parseAppEnv({ ...appEnv(), PUBLIC_BASE_DOMAIN: domain, ADMIN_ALERT_EMAIL: email })).not.toThrow();
    expect(() => parseWorkerEnv({ ...workerEnv(), EMAIL_FROM: email })).not.toThrow();
    expect(() => parseCliEnv({ ...cliEnv(), PUBLIC_BASE_DOMAIN: domain })).not.toThrow();
  });
});
