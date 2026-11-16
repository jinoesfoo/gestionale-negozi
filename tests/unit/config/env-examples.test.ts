import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAppEnv, parseCliEnv, parseWorkerEnv } from '@/config/env';

// Gli esempi delle variabili (01 §Variabili d'ambiente, FON-T01). Si leggono solo i file
// *.example e quelli di infra/env.example/: mai i file di ambiente veri.
const root = join(import.meta.dirname, '..', '..', '..');

type Entry = { value: string; optional: boolean };

/** Legge un file di esempio: righe NOME=valore, commenti con #, segno `# facoltativa` a fine riga. */
function readExample(relativePath: string): Map<string, Entry> {
  const text = readFileSync(join(root, relativePath), 'utf8');
  const entries = new Map<string, Entry>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`${relativePath}: riga non valida: ${line.slice(0, 40)}`);
    const name = match[1]!;
    let value = match[2]!;
    const optional = /\s#\s*facoltativa\s*$/.test(value) || /^#\s*facoltativa\s*$/.test(value);
    value = value.replace(/(^|\s)#.*$/, '').trim();
    expect(entries.has(name), `${relativePath}: ${name} ripetuta`).toBe(false);
    entries.set(name, { value, optional });
  }
  return entries;
}

const toEnv = (entries: Map<string, Entry>) =>
  Object.fromEntries([...entries].map(([name, entry]) => [name, entry.value]));

const COMMON = ['NODE_ENV', 'APP_ENV', 'PUBLIC_BASE_DOMAIN'];
const S3 = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];

// Variabili di FON-T01 per processo, senza APP_VERSION (01 §Variabili d'ambiente).
const APP = [
  ...COMMON,
  ...S3,
  'DATABASE_URL',
  'DATABASE_JOBS_URL',
  'BETTER_AUTH_SECRET',
  'JOB_PAYLOAD_KEY',
  'SHOP_SECRETS_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PORTAL_CONFIGURATION_ID',
  'EMAIL_WEBHOOK_TOKEN',
  'SENTRY_DSN',
  'HEALTH_TOKEN',
  'ADMIN_ALERT_EMAIL',
];
const WORKER = [
  ...COMMON,
  ...S3,
  'DATABASE_URL',
  'DATABASE_JOBS_URL',
  'JOB_PAYLOAD_KEY',
  'SHOP_SECRETS_KEY',
  'STRIPE_SECRET_KEY',
  'SDI_PROVIDER',
  'EMAIL_API_KEY',
  'EMAIL_FROM',
  'SENTRY_DSN',
  'ADMIN_ALERT_EMAIL',
];
const MIGRATE = [
  ...COMMON,
  ...S3,
  'DATABASE_OWNER_URL',
  'DATABASE_JOBS_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_TEST_CLOCK_SETUP',
  'ISOLATION_APP_DATABASE_URL',
  'ADMIN_ALERT_EMAIL',
];
const POSTGRES = [
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'APP_OWNER_PASSWORD',
  'APP_USER_PASSWORD',
  'APP_WORKER_PASSWORD',
  'APP_JOBS_PASSWORD',
  'PGBACKREST_REPO1_S3_ENDPOINT',
  'PGBACKREST_REPO1_S3_BUCKET',
  'PGBACKREST_REPO1_S3_REGION',
  'PGBACKREST_REPO1_S3_KEY',
  'PGBACKREST_REPO1_S3_KEY_SECRET',
  'PGBACKREST_REPO1_CIPHER_PASS',
];
const CADDY = ['BASE_DOMAIN', 'ACME_EMAIL', 'CF_API_TOKEN'];

// Variabili che nessun file di ambiente dei server deve contenere (01 FON-T01, specs/README.md).
const NEVER_ON_SERVERS = [
  'APP_VERSION',
  'STRIPE_LIVE_SECRET_KEY',
  'AUTH_RATE_LIMIT_TEST_ALLOW_IP',
  'ROLES_ALLOW_CREATEDB',
];

const DEV_EXAMPLES = [
  '.env.app.example',
  '.env.worker.example',
  '.env.migrate.example',
  '.env.test.example',
  '.env.test.owner.example',
];
const SERVER_EXAMPLES = ['app.env', 'worker.env', 'migrate.env', 'postgres.env', 'caddy.env'].map(
  (name) => `infra/env.example/${name}`,
);

function expectContains(file: string, names: string[]) {
  const entries = readExample(file);
  const missing = names.filter((name) => !entries.has(name));
  expect(missing, `${file}: variabili mancanti`).toEqual([]);
  return entries;
}

describe('esempi delle variabili di sviluppo', () => {
  it('FON-002: esistono i cinque esempi di sviluppo', () => {
    for (const file of DEV_EXAMPLES) expect(existsSync(join(root, file)), file).toBe(true);
  });

  it("FON-002: .env.app.example ha tutte le variabili dell'app ed è valido per il suo schema", () => {
    const entries = expectContains('.env.app.example', APP);
    expect(entries.has('DATABASE_OWNER_URL')).toBe(false);
    expect(() => parseAppEnv(toEnv(entries))).not.toThrow();
  });

  it('FON-002: .env.worker.example ha tutte le variabili del worker ed è valido per il suo schema', () => {
    const entries = expectContains('.env.worker.example', WORKER);
    expect(entries.has('DATABASE_OWNER_URL')).toBe(false);
    expect(entries.get('SDI_PROVIDER')?.value).toBe('fake');
    expect(() => parseWorkerEnv(toEnv(entries))).not.toThrow();
  });

  it('FON-002: .env.migrate.example ha tutte le variabili di migrate e CLI ed è valido per il suo schema', () => {
    const entries = expectContains('.env.migrate.example', MIGRATE);
    expect(() => parseCliEnv(toEnv(entries))).not.toThrow();
  });

  it('FON-002: .env.test.example ha le connessioni per ruolo e le variabili di app e worker, senza il proprietario', () => {
    const required = [
      'TEST_DATABASE_APP_URL',
      'TEST_DATABASE_WORKER_URL',
      'TEST_DATABASE_JOBS_URL',
      ...new Set([...APP, ...WORKER]),
    ].filter((name) => !['DATABASE_URL', 'STRIPE_PORTAL_CONFIGURATION_ID'].includes(name));
    const entries = expectContains('.env.test.example', required);
    expect(entries.has('TEST_DATABASE_OWNER_URL')).toBe(false);
    expect(entries.has('DATABASE_OWNER_URL')).toBe(false);
    expect(entries.get('NODE_ENV')?.value).toBe('test');
    expect(entries.get('APP_ENV')?.value).toBe('test');
    expect(entries.get('PUBLIC_BASE_DOMAIN')?.value).toBe('localhost');
    expect(entries.get('DATABASE_JOBS_URL')?.value).toBe(entries.get('TEST_DATABASE_JOBS_URL')?.value);

    // Il setup dei test copia la connessione del ruolo in DATABASE_URL: con quella gli schemi passano.
    const env = toEnv(entries);
    expect(() => parseAppEnv({ ...env, DATABASE_URL: env.TEST_DATABASE_APP_URL })).not.toThrow();
    expect(() => parseWorkerEnv({ ...env, DATABASE_URL: env.TEST_DATABASE_WORKER_URL })).not.toThrow();
  });

  it('FON-002: .env.test.owner.example contiene solo TEST_DATABASE_OWNER_URL', () => {
    expect([...readExample('.env.test.owner.example').keys()]).toEqual(['TEST_DATABASE_OWNER_URL']);
  });
});

describe('esempi delle variabili dei server (infra/env.example/)', () => {
  it('FON-002: esistono i cinque esempi dei server', () => {
    for (const file of SERVER_EXAMPLES) expect(existsSync(join(root, file)), file).toBe(true);
  });

  it('FON-002: ogni esempio dei server ha tutte le variabili del suo servizio', () => {
    expectContains('infra/env.example/app.env', APP);
    expectContains('infra/env.example/worker.env', [...WORKER, 'SDI_API_KEY', 'SDI_API_URL']);
    expectContains('infra/env.example/migrate.env', MIGRATE);
    expectContains('infra/env.example/postgres.env', POSTGRES);
    expectContains('infra/env.example/caddy.env', CADDY);
  });

  it('FON-002: DATABASE_OWNER_URL sta solo in migrate.env', () => {
    for (const file of SERVER_EXAMPLES) {
      const has = readExample(file).has('DATABASE_OWNER_URL');
      expect(has, file).toBe(file.endsWith('/migrate.env'));
    }
  });

  it('FON-002: negli esempi dei server non ci sono APP_VERSION, STRIPE_LIVE_SECRET_KEY, AUTH_RATE_LIMIT_TEST_ALLOW_IP e ROLES_ALLOW_CREATEDB', () => {
    for (const file of SERVER_EXAMPLES) {
      const entries = readExample(file);
      for (const name of NEVER_ON_SERVERS) expect(entries.has(name), `${file}: ${name}`).toBe(false);
    }
  });

  it("FON-002: # facoltativa segna STRIPE_PORTAL_CONFIGURATION_ID e STRIPE_TEST_CLOCK_SETUP e nessun'altra variabile di FON-T01", () => {
    const app = readExample('infra/env.example/app.env');
    const migrate = readExample('infra/env.example/migrate.env');
    expect(app.get('STRIPE_PORTAL_CONFIGURATION_ID')?.optional).toBe(true);
    expect(migrate.get('STRIPE_TEST_CLOCK_SETUP')?.optional).toBe(true);

    const expectedOptional = new Map([
      ['app.env', ['STRIPE_PORTAL_CONFIGURATION_ID']],
      ['migrate.env', ['STRIPE_TEST_CLOCK_SETUP']],
    ]);
    const fonT01 = new Map([
      ['app.env', APP],
      ['worker.env', [...WORKER, 'SDI_API_KEY', 'SDI_API_URL']],
      ['migrate.env', MIGRATE],
      ['postgres.env', POSTGRES],
      ['caddy.env', CADDY],
    ]);
    for (const [name, vars] of fonT01) {
      const entries = readExample(`infra/env.example/${name}`);
      const optional = vars.filter((v) => entries.get(v)?.optional);
      expect(optional, name).toEqual(expectedOptional.get(name) ?? []);
    }
  });
});

describe('STRIPE_LIVE_SECRET_KEY', () => {
  it('FON-002: non compare in nessun esempio, nemmeno in un commento', () => {
    for (const file of [...DEV_EXAMPLES, ...SERVER_EXAMPLES]) {
      const text = readFileSync(join(root, file), 'utf8');
      expect(text.includes('STRIPE_LIVE_SECRET_KEY'), file).toBe(false);
    }
  });
});
