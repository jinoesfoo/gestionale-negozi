import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvError, parseAppEnv, parseCliEnv, parseWorkerEnv } from '@/config/env';

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

type Env = Record<string, string | undefined>;

/** I valori come li passa Compose (`env_file:`): le virgolette di `NOME="" # facoltativa` danno un valore vuoto. */
const composeEnv = (entries: Map<string, Entry>): Env =>
  Object.fromEntries([...entries].map(([name, entry]) => [name, entry.value.replace(/^(["'])(.*)\1$/, '$2')]));

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

// Il ruolo di ogni indirizzo del database negli esempi di sviluppo (01 §Variabili d'ambiente e §Caricamento e
// validazione): le credenziali del proprietario stanno solo in DATABASE_OWNER_URL e TEST_DATABASE_OWNER_URL.
// Una variabile che non compare qui non ha un ruolo fissato da questo test.
const ROLES: Record<string, string> = {
  DATABASE_OWNER_URL: 'app_owner',
  TEST_DATABASE_OWNER_URL: 'app_owner',
  DATABASE_JOBS_URL: 'app_jobs',
  TEST_DATABASE_JOBS_URL: 'app_jobs',
  TEST_DATABASE_APP_URL: 'app_user',
  ISOLATION_APP_DATABASE_URL: 'app_user',
  TEST_DATABASE_WORKER_URL: 'app_worker',
};
const roleOf = (file: string, name: string): string | undefined =>
  name === 'DATABASE_URL' ? (file === '.env.worker.example' ? 'app_worker' : 'app_user') : ROLES[name];

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

  // La CI crea il database `app` (POSTGRES_DB=app), lo prepara con `pnpm db:migrate` e le variabili di
  // `.env.migrate.example`, poi esegue `test:int` con quelle di `.env.test.example` (01 §CI/CD); in locale
  // vale lo stesso, con il PostgreSQL di `infra/compose.dev.yml`. Il server è uno solo, quindi ogni ruolo ha
  // una sola password in tutti gli esempi (la CI crea i ruoli con le password degli esempi, FON-T08).
  it('FON-002: gli indirizzi PostgreSQL degli esempi di sviluppo puntano tutti al server e al database app che db:migrate prepara, con una sola password per ruolo', () => {
    const owner = readExample('.env.migrate.example').get('DATABASE_OWNER_URL')?.value ?? '';
    expect(() => new URL(owner), '.env.migrate.example: DATABASE_OWNER_URL non è un indirizzo').not.toThrow();
    const migrate = new URL(owner);
    expect(migrate.pathname, '.env.migrate.example: DATABASE_OWNER_URL').toBe('/app');
    const passwords = new Map<string, string>();
    for (const file of DEV_EXAMPLES) {
      // Ogni variabile con un indirizzo del database: DATABASE_URL, TEST_DATABASE_APP_URL, ISOLATION_APP_DATABASE_URL...
      const urls = [...readExample(file)].filter(([name]) => name.includes('DATABASE') && name.endsWith('_URL'));
      expect(urls.length, `${file}: nessun indirizzo PostgreSQL`).toBeGreaterThan(0);
      for (const [name, entry] of urls) {
        const value = entry.value.replace(/^(["'])(.*)\1$/, '$2');
        expect(() => new URL(value), `${file}: ${name} non è un indirizzo`).not.toThrow();
        const url = new URL(value);
        expect(`${url.host}${url.pathname}`, `${file}: ${name}`).toBe(`${migrate.host}${migrate.pathname}`);
        const role = roleOf(file, name);
        if (role !== undefined) expect(url.username, `${file}: ${name}: ruolo`).toBe(role);
        const known = passwords.get(url.username);
        if (known === undefined) passwords.set(url.username, url.password);
        else expect(url.password, `${file}: ${name}: password di ${url.username}`).toBe(known);
      }
    }
  });

  // Il bucket di `.env.test.example` è quello di cui la CI controlla il versioning (specs/README.md), e
  // l'emulatore di `infra/compose.dev.yml` crea all'avvio il bucket versionato (FON-T03): sviluppo e test
  // usano lo stesso emulatore, con le stesse credenziali e lo stesso bucket.
  it('FON-002: gli esempi di sviluppo usano lo stesso emulatore S3, con le stesse credenziali e lo stesso bucket', () => {
    const app = readExample('.env.app.example');
    for (const file of ['.env.worker.example', '.env.migrate.example', '.env.test.example']) {
      const entries = readExample(file);
      for (const name of S3) expect(entries.get(name)?.value, `${file}: ${name}`).toBe(app.get(name)?.value);
    }
  });

  // 01 FON-T01: gli esempi di sviluppo restano NOME=, senza segno e senza spazi in fondo alla riga: il parser di Node,
  // con uno spazio dopo `=` e nient'altro, prenderebbe la riga seguente come valore.
  it('FON-002: negli esempi di sviluppo nessuna variabile ha il segno # facoltativa e nessuna riga finisce con spazi', () => {
    for (const file of DEV_EXAMPLES) {
      readFileSync(join(root, file), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          expect(/[ \t]$/.test(line), `${file}:${index + 1}: spazi in fondo alla riga`).toBe(false);
          if (line.trimStart().startsWith('#')) return;
          expect(/facoltativa/i.test(line), `${file}:${index + 1}: segno facoltativa`).toBe(false);
        });
    }
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

  // 01 FON-T01: sui server una variabile facoltativa ancora senza valore si scrive NOME="" # facoltativa. Compose
  // toglie gli spazi dopo `=` e riconosce un commento in coda solo dopo ` #`: con `NOME= # facoltativa` o
  // `NOME=# facoltativa` il valore diventerebbe `# facoltativa`. readExample riconosce il segno anche in quelle forme,
  // quindi qui si controlla la riga com'è scritta.
  it('FON-002: negli esempi dei server una variabile facoltativa si scrive NOME="" # facoltativa', () => {
    let marked = 0;
    for (const file of SERVER_EXAMPLES) {
      readFileSync(join(root, file), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (line.trimStart().startsWith('#') || !/facoltativa/i.test(line)) return;
          marked++;
          expect(line, `${file}:${index + 1}`).toMatch(/^[A-Z][A-Z0-9_]*="" # facoltativa$/);
        });
    }
    expect(marked, 'nessuna variabile facoltativa negli esempi dei server').toBeGreaterThan(0);
  });

  // 01 §Variabili d'ambiente: negli esempi dei server ogni valore che l'utente deve scrivere contiene CAMBIA, compresi
  // dominio, indirizzi e APP_ENV, così una sostituzione dimenticata la ferma lo schema (app.env, worker.env,
  // migrate.env) o il controllo delle procedure di infra/README.md (caddy.env, postgres.env). Restano scritti per
  // intero solo i valori uguali su tutti i server e le facoltative ancora vuote. EMAIL_PROVIDER=brevo la aggiunge a
  // worker.env FON-T10: finché la variabile non c'è, la sua voce non conta.
  it('FON-002: negli esempi dei server ogni valore da scrivere contiene CAMBIA, tranne i valori uguali su tutti i server e le facoltative vuote', () => {
    const fixed = new Map([
      ['NODE_ENV', 'production'],
      ['POSTGRES_DB', 'app'],
      ['POSTGRES_USER', 'postgres'],
      ['EMAIL_PROVIDER', 'brevo'],
    ]);
    for (const file of SERVER_EXAMPLES) {
      const withoutCambia: string[] = [];
      for (const [name, entry] of readExample(file)) {
        if (fixed.has(name)) expect(entry.value, `${file}: ${name}`).toBe(fixed.get(name));
        else if (!(entry.optional && entry.value === '""') && !entry.value.includes('CAMBIA')) withoutCambia.push(name);
      }
      expect(withoutCambia, `${file}: valori da scrivere senza CAMBIA`).toEqual([]);
    }
  });

  // 01 §Variabili d'ambiente: un valore che contiene ancora CAMBIA non è valido. Letto come lo legge Compose, con
  // l'APP_VERSION che mette l'immagine, ogni esempio dei server è rifiutato dal suo schema esattamente nelle variabili
  // che contengono ancora CAMBIA: una sostituzione dimenticata ferma l'avvio, e il resto dell'esempio è valido. Nel CLI
  // fanno eccezione le chiavi Stripe, che controllano solo i comandi Stripe.
  it('FON-002: ogni esempio dei server è rifiutato dal suo schema proprio nelle variabili che contengono ancora CAMBIA', () => {
    const cases: [string, (env: Env) => unknown, string[]][] = [
      ['app.env', parseAppEnv, []],
      ['worker.env', parseWorkerEnv, []],
      ['migrate.env', parseCliEnv, ['STRIPE_SECRET_KEY', 'STRIPE_LIVE_SECRET_KEY']],
    ];
    for (const [name, parse, unchecked] of cases) {
      const file = `infra/env.example/${name}`;
      const env: Env = { ...composeEnv(readExample(file)), APP_VERSION: 'a'.repeat(40) };
      const toReplace = Object.keys(env).filter((key) => env[key]?.includes('CAMBIA') && !unchecked.includes(key));
      expect(toReplace.length, `${file}: nessun valore da sostituire`).toBeGreaterThan(0);
      let rejected: string[] = [];
      try {
        parse(env);
      } catch (error) {
        if (!(error instanceof EnvError)) throw error;
        rejected = error.variables;
      }
      expect([...rejected].sort(), file).toEqual([...toReplace].sort());
    }
  });
});

// EMAIL_PROVIDER la aggiunge FON-T10 allo schema del worker e ai tre esempi (01 §Variabili d'ambiente): `fake` negli
// esempi di sviluppo e di test, `brevo` nell'esempio del server, da cui l'utente scrive i worker.env dei due server in
// FON-T07b (anche il server di test invia email vere). Non è facoltativa, e app e migrate non la ricevono.
describe('EMAIL_PROVIDER negli esempi', () => {
  it('FON-002: EMAIL_PROVIDER=fake in .env.worker.example e in .env.test.example', () => {
    for (const file of ['.env.worker.example', '.env.test.example']) {
      expect(readExample(file).get('EMAIL_PROVIDER')?.value, file).toBe('fake');
    }
  });

  it('FON-002: EMAIL_PROVIDER=brevo in infra/env.example/worker.env, non facoltativa', () => {
    const entry = readExample('infra/env.example/worker.env').get('EMAIL_PROVIDER');
    expect(entry?.value).toBe('brevo');
    expect(entry?.optional).toBe(false);
  });

  it('FON-002: EMAIL_PROVIDER non sta negli esempi di app e migrate', () => {
    for (const file of [
      '.env.app.example',
      '.env.migrate.example',
      'infra/env.example/app.env',
      'infra/env.example/migrate.env',
    ]) {
      expect(readExample(file).has('EMAIL_PROVIDER'), file).toBe(false);
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
