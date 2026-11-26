import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findPgbackrestProblems } from '../../../infra/scripts/check-pgbackrest-compose';

// Il controllo del servizio una tantum pgbackrest-init (infra/scripts/check-pgbackrest-compose.ts), che
// infra/check-ports.sh esegue dopo check-compose.ts sulla stessa uscita di `docker compose config --format json`
// (OPS-001; 08 §pgBackRest, «Primo avvio», e OPS-T01a, note del piano, «infra/compose.yml»; 01 §Servizi Docker
// Compose, riga di pgbackrest-init, e §Variabili d'ambiente, servizio postgres). Provato su configurazioni scritte qui,
// nella forma risolta che scrive Compose, come in check-compose.test.ts: `depends_on` in forma lunga con `required`,
// volumi in forma lunga, `environment` come mappa con i valori dei file di ambiente (qui valori di prova riconoscibili,
// che non devono mai comparire nell'uscita, 00 §4.2). Reti, log, porte e restart dei servizi sempre attivi li controlla
// check-compose.ts (FON-T06), e qui non si ripetono. Il controllo vero, sulla configurazione di infra/compose.yml
// calcolata da Docker, lo lancia l'utente con infra/check-ports.sh; qui check-ports.sh gira con un `docker` finto, che
// stampa le configurazioni scritte dal test, per provare che passa la stessa configurazione ai due controlli.

const CHECKER = fileURLToPath(new URL('../../../infra/scripts/check-pgbackrest-compose.ts', import.meta.url));
const CHECK_PORTS = fileURLToPath(new URL('../../../infra/check-ports.sh', import.meta.url));
const INIT_DIR = fileURLToPath(new URL('../../../infra/postgres/init', import.meta.url));

const INIT = 'pgbackrest-init';
const POSTGRES_IMAGE = 'ghcr.io/jinoesfoo/gestionale-negozi-postgres:check-ports';
const APP_IMAGE = 'ghcr.io/jinoesfoo/gestionale-negozi-app:check-ports';

/** Le sei variabili di pgBackRest di postgres.env (01 §Variabili d'ambiente, servizio postgres). */
const PGBACKREST_VARIABLES = [
  'PGBACKREST_REPO1_S3_ENDPOINT',
  'PGBACKREST_REPO1_S3_BUCKET',
  'PGBACKREST_REPO1_S3_REGION',
  'PGBACKREST_REPO1_S3_KEY',
  'PGBACKREST_REPO1_S3_KEY_SECRET',
  'PGBACKREST_REPO1_CIPHER_PASS',
];

/** Testi che stanno solo nei valori di prova (variabili e immagini): mai nell'uscita del controllo. */
const VALUE_MARKERS = ['VALORE-PROVA', 'ghcr.io'];

const OTHER_SERVICES = ['caddy', 'app', 'worker', 'migrate'];
const WAITING_SERVICES = ['app', 'worker'];

type Service = Record<string, unknown>;
interface Config {
  name: string;
  services: Record<string, Service>;
  networks: Record<string, Record<string, unknown>>;
  volumes: Record<string, Record<string, unknown>>;
}

const logging = () => ({ driver: 'json-file', options: { 'max-file': '5', 'max-size': '10m' } });
const dependency = (condition: string) => ({ condition, required: true });
const namedVolume = (source: string, target: string) => ({ type: 'volume', source, target, volume: {} });
const pgdata = () => namedVolume('pgdata', '/var/lib/postgresql');
const pgsocket = () => namedVolume('pgsocket', '/var/run/postgresql');
const tcp = (port: number) => ({ mode: 'ingress', target: port, published: String(port), protocol: 'tcp' });

/** postgres.env come Compose lo scrive in `environment` (lo legge anche pgbackrest-init), con valori di prova. */
function postgresEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    POSTGRES_DB: 'app',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'VALORE-PROVA-SEGRETO-PW-POSTGRES',
    APP_OWNER_PASSWORD: 'VALORE-PROVA-SEGRETO-PW-OWNER',
    APP_USER_PASSWORD: 'VALORE-PROVA-SEGRETO-PW-USER',
  };
  for (const [index, name] of PGBACKREST_VARIABLES.entries()) {
    environment[name] = `VALORE-PROVA-SEGRETO-PGBACKREST-${index + 1}`;
  }
  return environment;
}

/** Una configurazione corretta, come la scriverebbe `docker compose config --format json`. */
function validConfig(): Config {
  return {
    name: 'app',
    networks: { edge: { name: 'app_edge', ipam: {} }, internal: { name: 'app_internal', ipam: {} } },
    services: {
      caddy: {
        image: 'ghcr.io/jinoesfoo/gestionale-negozi-caddy:check-ports',
        environment: { CF_API_TOKEN: 'VALORE-PROVA-SEGRETO-CLOUDFLARE' },
        networks: { edge: null, internal: null },
        ports: [tcp(80), tcp(443)],
        restart: 'unless-stopped',
        logging: logging(),
        volumes: [namedVolume('caddy_data', '/data'), namedVolume('caddy_config', '/config')],
      },
      app: {
        image: APP_IMAGE,
        command: ['node', 'server.js'],
        environment: { DATABASE_URL: 'postgres://app_user:VALORE-PROVA-SEGRETO-PW-USER@postgres:5432/app' },
        networks: { internal: null },
        depends_on: { postgres: dependency('service_healthy'), [INIT]: dependency('service_completed_successfully') },
        restart: 'unless-stopped',
        logging: logging(),
      },
      worker: {
        image: APP_IMAGE,
        command: ['node', 'dist/worker.js'],
        environment: { DATABASE_URL: 'postgres://app_worker:VALORE-PROVA-SEGRETO-PW-WORKER@postgres:5432/app' },
        networks: { internal: null },
        depends_on: { postgres: dependency('service_healthy'), [INIT]: dependency('service_completed_successfully') },
        restart: 'unless-stopped',
        logging: logging(),
      },
      migrate: {
        image: APP_IMAGE,
        command: ['node', 'dist/migrate.js'],
        profiles: ['tools'],
        environment: { DATABASE_OWNER_URL: 'postgres://app_owner:VALORE-PROVA-SEGRETO-PW-OWNER@postgres:5432/app' },
        networks: { internal: null },
        depends_on: { postgres: dependency('service_healthy') },
        restart: 'no',
        logging: logging(),
      },
      postgres: {
        image: POSTGRES_IMAGE,
        environment: postgresEnvironment(),
        networks: { internal: null },
        restart: 'unless-stopped',
        logging: logging(),
        volumes: [
          pgdata(),
          pgsocket(),
          { type: 'bind', source: INIT_DIR, target: '/docker-entrypoint-initdb.d', read_only: true, bind: {} },
        ],
      },
      [INIT]: {
        image: POSTGRES_IMAGE,
        command: [INIT],
        user: 'postgres',
        environment: postgresEnvironment(),
        networks: { internal: null },
        depends_on: { postgres: dependency('service_healthy') },
        healthcheck: { disable: true },
        restart: 'no',
        logging: logging(),
        volumes: [pgdata(), pgsocket()],
      },
    },
    volumes: {
      caddy_data: { name: 'app_caddy_data' },
      caddy_config: { name: 'app_caddy_config' },
      pgdata: { name: 'app_pgdata' },
      pgsocket: { name: 'app_pgsocket' },
    },
  };
}

/** Una configurazione corretta con una modifica, e i suoi problemi. */
function problemsWith(change: (config: Config) => void): string[] {
  const config = validConfig();
  change(config);
  return findPgbackrestProblems(config);
}

function service(config: Config, name: string): Service {
  const found = config.services[name];
  if (!found) throw new Error(`servizio ${name} assente dalla configurazione di prova`);
  return found;
}

/** Un campo oggetto (`environment`, `depends_on`) di un servizio della configurazione di prova. */
function field(config: Config, name: string, key: string): Record<string, unknown> {
  const value = service(config, name)[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name}.${key} non è un oggetto nella configurazione di prova`);
  }
  return value as Record<string, unknown>;
}

/** I volumi del servizio senza quelli del volume con nome `source`. */
function volumesWithout(config: Config, name: string, source: string): unknown[] {
  return (service(config, name).volumes as Record<string, unknown>[]).filter((volume) => volume.source !== source);
}

/** Il nome compare intero nel testo: PGBACKREST_REPO1_S3_KEY non vale dentro PGBACKREST_REPO1_S3_KEY_SECRET. */
function mentions(text: string | undefined, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`).test(text ?? '');
}

function expectNoValues(text: string): void {
  for (const marker of VALUE_MARKERS) expect(text).not.toContain(marker);
}

/**
 * Un solo problema, attribuito a `subject` (il servizio con cui comincia, `<servizio>: …`; null per il progetto), che
 * nomina tutti i nomi dati, cita il requisito e non contiene valori.
 */
function expectOneProblem(problems: string[], subject: string | null, names: string[]): void {
  expect(problems, problems.join('\n')).toHaveLength(1);
  const problem = problems[0] ?? '';
  if (subject !== null) expect(problem.startsWith(`${subject}: `), problem).toBe(true);
  for (const name of names) expect(mentions(problem, name), `${problem} deve nominare ${name}`).toBe(true);
  expect(problem).toMatch(/OPS-00[12]/);
  expectNoValues(problem);
}

/** Una regola: il caso, la modifica che la viola, il servizio del problema (null: il progetto) e i nomi che cita. */
type RuleCase = [rule: string, change: (config: Config) => void, subject: string | null, names: string[]];

const RULES: RuleCase[] = [
  [
    'pgbackrest-init usa la stessa immagine di postgres',
    (config) => (service(config, INIT).image = APP_IMAGE),
    INIT,
    [INIT],
  ],
  [
    'il comando di pgbackrest-init è esattamente [pgbackrest-init]',
    (config) => (service(config, INIT).command = [INIT, '--verbose']),
    INIT,
    [INIT],
  ],
  ['pgbackrest-init gira con l’utente postgres', (config) => (service(config, INIT).user = 'root'), INIT, [INIT]],
  ['pgbackrest-init ha restart "no"', (config) => (service(config, INIT).restart = 'on-failure'), INIT, [INIT]],
  [
    'pgbackrest-init aspetta postgres in salute (service_healthy)',
    (config) => (field(config, INIT, 'depends_on').postgres = dependency('service_started')),
    INIT,
    [INIT, 'postgres'],
  ],
  [
    'pgbackrest-init ha il controllo di salute disattivato (healthcheck disable: true)',
    (config) => delete service(config, INIT).healthcheck,
    INIT,
    [INIT],
  ],
  [
    'pgbackrest-init monta il volume pgdata su /var/lib/postgresql',
    (config) => (service(config, INIT).volumes = [pgsocket()]),
    INIT,
    [INIT, 'pgdata'],
  ],
  [
    'pgbackrest-init monta il volume pgsocket su /var/run/postgresql',
    (config) => (service(config, INIT).volumes = [pgdata()]),
    INIT,
    [INIT, 'pgsocket'],
  ],
  [
    'postgres monta il volume pgsocket su /var/run/postgresql',
    (config) => (service(config, 'postgres').volumes = volumesWithout(config, 'postgres', 'pgsocket')),
    'postgres',
    ['postgres', 'pgsocket'],
  ],
  [
    'app aspetta la fine riuscita di pgbackrest-init (service_completed_successfully)',
    (config) => delete field(config, 'app', 'depends_on')[INIT],
    'app',
    ['app', INIT],
  ],
  [
    'worker aspetta la fine riuscita di pgbackrest-init (service_completed_successfully)',
    (config) => delete field(config, 'worker', 'depends_on')[INIT],
    'worker',
    ['worker', INIT],
  ],
  [
    'migrate non dipende da pgbackrest-init',
    (config) => (field(config, 'migrate', 'depends_on')[INIT] = dependency('service_completed_successfully')),
    'migrate',
    ['migrate', INIT],
  ],
  ['il progetto dichiara il volume pgsocket', (config) => delete config.volumes.pgsocket, null, ['pgsocket']],
  [
    'postgres ha nell’ambiente le sei variabili di pgBackRest',
    (config) => delete field(config, 'postgres', 'environment').PGBACKREST_REPO1_CIPHER_PASS,
    'postgres',
    ['postgres', 'PGBACKREST_REPO1_CIPHER_PASS'],
  ],
  [
    'pgbackrest-init ha nell’ambiente le sei variabili di pgBackRest',
    (config) => delete field(config, INIT, 'environment').PGBACKREST_REPO1_S3_KEY_SECRET,
    INIT,
    [INIT, 'PGBACKREST_REPO1_S3_KEY_SECRET'],
  ],
  [
    'nessun altro servizio riceve variabili PGBACKREST_* (00 §4.1)',
    (config) => (field(config, 'app', 'environment').PGBACKREST_REPO1_S3_KEY = 'VALORE-PROVA-SEGRETO-CHIAVE-IN-APP'),
    'app',
    ['app', 'PGBACKREST_REPO1_S3_KEY'],
  ],
];

describe('controllo di pgbackrest-init nella configurazione Compose (infra/scripts/check-pgbackrest-compose.ts)', () => {
  it('OPS-001: la configurazione corretta non ha problemi', () => {
    expect(findPgbackrestProblems(validConfig())).toEqual([]);
  });

  it('OPS-001: senza il servizio pgbackrest-init c’è un solo problema, e le sue altre regole non si controllano', () => {
    expect(problemsWith((config) => delete config.services[INIT])).toEqual([
      'manca il servizio pgbackrest-init (OPS-001)',
    ]);
  });

  it.each(RULES)('OPS-001: %s (altrimenti un problema solo)', (_rule, change, subject, names) => {
    expectOneProblem(problemsWith(change), subject, names);
  });

  it.each<[string, unknown, unknown]>([
    ['diversa da quella di postgres', APP_IMAGE, POSTGRES_IMAGE],
    // Stesso repository, un altro tag: pgbackrest-init girerebbe con un'altra versione dell'immagine.
    ['con un altro tag della stessa immagine', 'ghcr.io/jinoesfoo/gestionale-negozi-postgres:18.7-1', POSTGRES_IMAGE],
    ['assente', undefined, POSTGRES_IMAGE],
    ['assente, come quella di postgres', undefined, undefined],
    ['vuota, come quella di postgres', '', ''],
  ])('OPS-001: un’immagine di pgbackrest-init %s è un problema', (_case, initImage, postgresImage) => {
    const problems = problemsWith((config) => {
      service(config, INIT).image = initImage;
      service(config, 'postgres').image = postgresImage;
    });
    expectOneProblem(problems, INIT, [INIT]);
  });

  it.each<[string, unknown]>([
    ['assente (null)', null],
    ['scritto come testo', INIT],
    ['con il percorso completo', ['/usr/local/bin/pgbackrest-init']],
    ['dentro una shell', ['bash', '-c', INIT]],
    ['vuoto', []],
  ])('OPS-001: un comando di pgbackrest-init %s è un problema', (_case, command) => {
    expectOneProblem(
      problemsWith((config) => (service(config, INIT).command = command)),
      INIT,
      [INIT],
    );
  });

  it.each<[string, unknown]>([
    ['assente', undefined],
    ['root', 'root'],
    ['0', '0'],
  ])('OPS-001: l’utente di pgbackrest-init (%s) diverso da postgres è un problema', (_case, user) => {
    expectOneProblem(
      problemsWith((config) => (service(config, INIT).user = user)),
      INIT,
      [INIT],
    );
  });

  it.each<[string, unknown]>([
    ['assente', undefined],
    ['unless-stopped', 'unless-stopped'],
    ['always', 'always'],
  ])('OPS-001: restart di pgbackrest-init (%s) diverso da "no" è un problema', (_case, restart) => {
    expectOneProblem(
      problemsWith((config) => (service(config, INIT).restart = restart)),
      INIT,
      [INIT],
    );
  });

  it.each<[string, unknown]>([
    ['senza depends_on', undefined],
    ['senza postgres in depends_on', {}],
    ['con postgres solo avviato', { postgres: dependency('service_started') }],
    ['con postgres finito', { postgres: dependency('service_completed_successfully') }],
  ])('OPS-001: pgbackrest-init %s (invece di postgres in salute) è un problema', (_case, dependsOn) => {
    expectOneProblem(
      problemsWith((config) => (service(config, INIT).depends_on = dependsOn)),
      INIT,
      [INIT],
    );
  });

  it.each<[string, unknown]>([
    ['attivo (disable: false)', { disable: false }],
    ['con un test proprio', { test: ['CMD', 'true'], interval: '30s' }],
  ])('OPS-001: il controllo di salute di pgbackrest-init %s è un problema', (_case, healthcheck) => {
    expectOneProblem(
      problemsWith((config) => (service(config, INIT).healthcheck = healthcheck)),
      INIT,
      [INIT],
    );
  });

  it.each<[string, Service, string]>([
    ['pgdata montato sulla cartella dei dati', namedVolume('pgdata', '/var/lib/postgresql/18/docker'), 'pgdata'],
    [
      'pgdata come cartella dell’host',
      { type: 'bind', source: '/srv/app/pgdata', target: '/var/lib/postgresql', bind: {} },
      'pgdata',
    ],
    // Solo il tipo è sbagliato: nella forma risolta una cartella dell'host ha il percorso assoluto, ma la regola vuole
    // proprio un volume con nome.
    ['pgdata di tipo bind', { type: 'bind', source: 'pgdata', target: '/var/lib/postgresql', bind: {} }, 'pgdata'],
    ['un altro volume su /var/lib/postgresql', namedVolume('pgdata2', '/var/lib/postgresql'), 'pgdata'],
    ['pgsocket su un’altra cartella', namedVolume('pgsocket', '/tmp'), 'pgsocket'],
  ])('OPS-001: pgbackrest-init con %s al posto del volume giusto è un problema', (_case, wrong, missing) => {
    const problems = problemsWith((config) => {
      service(config, INIT).volumes = [...volumesWithout(config, INIT, missing), wrong];
    });
    expectOneProblem(problems, INIT, [INIT, missing]);
  });

  it('OPS-001: pgbackrest-init senza volumi è un problema, per pgdata e per pgsocket', () => {
    const problems = problemsWith((config) => delete service(config, INIT).volumes);
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) expect(problem.startsWith(`${INIT}: `), problem).toBe(true);
    expect(mentions(problems.join('\n'), 'pgdata')).toBe(true);
    expect(mentions(problems.join('\n'), 'pgsocket')).toBe(true);
  });

  it('OPS-001: postgres con pgsocket su un’altra cartella è un problema', () => {
    const problems = problemsWith((config) => {
      service(config, 'postgres').volumes = [
        ...volumesWithout(config, 'postgres', 'pgsocket'),
        namedVolume('pgsocket', '/tmp'),
      ];
    });
    expectOneProblem(problems, 'postgres', ['postgres', 'pgsocket']);
  });

  it.each(
    WAITING_SERVICES.flatMap((name): [string, string, unknown][] => [
      [name, 'solo avviato', dependency('service_started')],
      [name, 'in salute', dependency('service_healthy')],
      [name, 'scritto senza condizione', { required: true }],
    ]),
  )('OPS-001: %s che aspetta pgbackrest-init %s (invece della fine riuscita) è un problema', (name, _case, value) => {
    const problems = problemsWith((config) => (field(config, name, 'depends_on')[INIT] = value));
    expectOneProblem(problems, name, [name, INIT]);
  });

  it('OPS-001: se né app né worker aspettano pgbackrest-init, c’è un problema per ciascuno', () => {
    const problems = problemsWith((config) => {
      for (const name of WAITING_SERVICES) delete field(config, name, 'depends_on')[INIT];
    });
    expect(problems).toHaveLength(2);
    expect(problems.filter((problem) => problem.startsWith('app: '))).toHaveLength(1);
    expect(problems.filter((problem) => problem.startsWith('worker: '))).toHaveLength(1);
  });

  it.each(['service_started', 'service_healthy'])(
    'OPS-001: migrate che dipende da pgbackrest-init (%s) è un problema',
    (condition) => {
      const problems = problemsWith((config) => (field(config, 'migrate', 'depends_on')[INIT] = dependency(condition)));
      expectOneProblem(problems, 'migrate', ['migrate', INIT]);
    },
  );

  it.each(PGBACKREST_VARIABLES)('OPS-001: postgres senza %s nell’ambiente è un problema che la nomina', (variable) => {
    const problems = problemsWith((config) => delete field(config, 'postgres', 'environment')[variable]);
    expectOneProblem(problems, 'postgres', ['postgres', variable]);
    for (const other of PGBACKREST_VARIABLES.filter((name) => name !== variable)) {
      expect(mentions(problems[0], other), `${other} c’è: non va nominata`).toBe(false);
    }
  });

  it.each(PGBACKREST_VARIABLES)(
    'OPS-001: pgbackrest-init senza %s nell’ambiente è un problema che la nomina',
    (variable) => {
      const problems = problemsWith((config) => delete field(config, INIT, 'environment')[variable]);
      expectOneProblem(problems, INIT, [INIT, variable]);
      for (const other of PGBACKREST_VARIABLES.filter((name) => name !== variable)) {
        expect(mentions(problems[0], other), `${other} c’è: non va nominata`).toBe(false);
      }
    },
  );

  it.each(['postgres', INIT])(
    'OPS-001: %s senza nessuna variabile di pgBackRest (file di ambiente non letto) è un problema che le nomina tutte',
    (name) => {
      const problems = problemsWith((config) => (service(config, name).environment = { POSTGRES_DB: 'app' }));
      expect(problems.length).toBeGreaterThan(0);
      for (const problem of problems) expect(problem.startsWith(`${name}: `), problem).toBe(true);
      for (const variable of PGBACKREST_VARIABLES) expect(mentions(problems.join('\n'), variable)).toBe(true);
    },
  );

  it.each(
    [...OTHER_SERVICES, 'backup-extra'].flatMap((name): [string, string, string][] => [
      [name, 'PGBACKREST_REPO1_S3_KEY_SECRET', `VALORE-PROVA-SEGRETO-IN-${name}`],
      [name, 'PGBACKREST_REPO1_CIPHER_PASS', ''],
      [name, 'PGBACKREST_LOG_LEVEL_CONSOLE', 'VALORE-PROVA-info'],
    ]),
  )(
    'OPS-001, 00§4.2: %s con %s nell’ambiente è un problema (00 §4.1), scritto senza il valore',
    (name, variable, value) => {
      const problems = problemsWith((config) => {
        config.services[name] ??= { image: APP_IMAGE, environment: {} };
        field(config, name, 'environment')[variable] = value;
      });
      expectOneProblem(problems, name, [name, variable]);
    },
  );

  it('OPS-001: reti, log, porte e restart dei servizi sempre attivi non si controllano qui (li controlla check-compose.ts)', () => {
    const problems = problemsWith((config) => {
      delete service(config, INIT).logging;
      service(config, INIT).networks = { edge: null };
      service(config, INIT).ports = [tcp(5432)];
      delete service(config, 'worker').logging;
      service(config, 'postgres').restart = 'always';
      service(config, 'app').restart = 'no';
    });
    expect(problems).toEqual([]);
  });

  it('OPS-001, 00§4.2: i problemi nominano servizi, volumi e variabili, mai i valori', () => {
    const problems = problemsWith((config) => {
      service(config, INIT).image = APP_IMAGE;
      service(config, INIT).command = ['sh', '-c', 'VALORE-PROVA-SEGRETO-COMANDO'];
      service(config, INIT).user = 'VALORE-PROVA-UTENTE';
      delete field(config, 'postgres', 'environment').PGBACKREST_REPO1_S3_KEY;
      for (const name of OTHER_SERVICES) {
        field(config, name, 'environment').PGBACKREST_REPO1_CIPHER_PASS = `VALORE-PROVA-SEGRETO-CIFRATURA-${name}`;
      }
    });
    expect(problems.length).toBeGreaterThanOrEqual(8);
    expectNoValues(problems.join('\n'));
  });
});

describe('controllo di pgbackrest-init da riga di comando', () => {
  function runChecker(input: string, label = 'test') {
    // Solo le variabili che servono: node si lancia con il percorso completo. --disable-warning: le prime versioni di
    // Node 24 scrivono sullo standard error un avviso sui tipi tolti dal file .ts, che qui non conta.
    const childEnv: Record<string, string> = { PATH: '/usr/bin:/bin', TMPDIR: tmpdir() };
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CHECKER, label], {
      input,
      // I tipi di Next.js vogliono NODE_ENV in ProcessEnv: qui l'ambiente ha solo le variabili date.
      env: childEnv as NodeJS.ProcessEnv,
      encoding: 'utf8',
      timeout: 15_000,
    });
    if (result.error) throw result.error;
    return result;
  }

  it.each(['test', 'prod'])('OPS-001: con la configurazione corretta (%s) termina con 0 e una riga OK', (label) => {
    const result = runChecker(JSON.stringify(validConfig()), label);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`OK: pgbackrest-init (${label}) senza problemi.\n`);
    expect(result.status).toBe(0);
  });

  it('OPS-001, 00§4.2: con dei problemi termina con 1 e li elenca sullo standard error, senza valori', () => {
    const config = validConfig();
    service(config, INIT).image = APP_IMAGE;
    delete field(config, 'worker', 'depends_on')[INIT];
    field(config, 'migrate', 'environment').PGBACKREST_REPO1_CIPHER_PASS = 'VALORE-PROVA-SEGRETO-CIFRATURA-MIGRATE';
    const problems = findPgbackrestProblems(config);
    expect(problems).toHaveLength(3);

    const result = runChecker(JSON.stringify(config));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    const expected = ['Configurazione Compose (test), pgbackrest-init: 3 problemi.', ...problems.map((p) => `- ${p}`)];
    expect(result.stderr).toBe(`${expected.join('\n')}\n`);
    expectNoValues(result.stdout + result.stderr);
  });

  it('OPS-001: senza il servizio pgbackrest-init termina con 1 e lo dice', () => {
    const config = validConfig();
    delete config.services[INIT];
    const result = runChecker(JSON.stringify(config));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.split('\n')).toContain('- manca il servizio pgbackrest-init (OPS-001)');
  });

  // Il messaggio d'errore di JSON.parse ripete l'ingresso intero se è più corto di 21 caratteri, altrimenti fino a 10
  // caratteri prima e dopo il punto dell'errore: gli ultimi due casi lo farebbero comparire con un valore.
  it.each([
    ['testo qualsiasi', 'non è json: VALORE-PROVA-SEGRETO-TESTO'],
    [
      'JSON troncato',
      '{"services": {"postgres": {"environment": {"PGBACKREST_REPO1_CIPHER_PASS": "VALORE-PROVA-SEGRETO',
    ],
    ['vuoto', ''],
    ['un valore breve', 'VALORE-PROVA-SEGRETO'],
    ['un valore senza virgolette', '{"PGBACKREST_REPO1_CIPHER_PASS": VALORE-PROVA-SEGRETO}'],
  ])(
    'OPS-001, 00§4.2: uno standard input che non è JSON (%s) termina con 1 e una riga sola, senza ripeterlo',
    (_case, input) => {
      const result = runChecker(input);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/^[^\n]+\n$/);
      expectNoValues(result.stderr);
      expect(result.stderr).not.toContain('VALORE');
      expect(result.stderr).not.toContain('PGBACKREST');
    },
  );
});

describe('infra/check-ports.sh con un docker finto', () => {
  /** La radice del repository, come la calcola check-ports.sh (`cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd`). */
  const ROOT = resolve(dirname(CHECK_PORTS), '..');

  /**
   * Il docker finto: per ogni chiamata scrive una riga in docker-calls, con le variabili che check-ports.sh esporta e
   * gli argomenti, separati da \x1f, e stampa la configurazione dell'ambiente (prod.json se fra gli argomenti c'è
   * compose.prod.yml, altrimenti test.json).
   */
  const FAKE_DOCKER = `#!/bin/sh
printf '%s\\037' "ENV_DIR=$ENV_DIR" "APP_TAG=$APP_TAG" "CADDY_TAG=$CADDY_TAG" "POSTGRES_TAG=$POSTGRES_TAG" "$@" >> "$FAKE_DIR/docker-calls"
printf '\\n' >> "$FAKE_DIR/docker-calls"
case "$*" in
  *compose.prod.yml*) exec cat "$FAKE_DIR/prod.json" ;;
  *) exec cat "$FAKE_DIR/test.json" ;;
esac
`;

  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-t01a-check-ports-'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'docker'), FAKE_DOCKER);
    chmodSync(join(dir, 'bin', 'docker'), 0o755);
    // check-ports.sh cerca node nel PATH: qui è lo stesso node dei test, senza il PATH di chi li lancia.
    symlinkSync(process.execPath, join(dir, 'bin', 'node'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Lancia check-ports.sh con le configurazioni che il docker finto stampa per test e per prod. */
  function runCheckPorts(test: Config, prod: Config) {
    writeFileSync(join(dir, 'test.json'), JSON.stringify(test));
    writeFileSync(join(dir, 'prod.json'), JSON.stringify(prod));
    const childEnv: Record<string, string> = {
      PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
      TMPDIR: tmpdir(),
      FAKE_DIR: dir,
    };
    const result = spawnSync('bash', [CHECK_PORTS], {
      env: childEnv as NodeJS.ProcessEnv,
      encoding: 'utf8',
      timeout: 15_000,
    });
    if (result.error) throw result.error;
    const callsFile = join(dir, 'docker-calls');
    const dockerCalls = existsSync(callsFile)
      ? readFileSync(callsFile, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => line.split('\x1f').slice(0, -1))
      : [];
    const stdoutLines = result.stdout.split('\n').filter((line) => line !== '');
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, stdoutLines, dockerCalls };
  }

  /** La chiamata di docker attesa per un ambiente: variabili esportate e argomenti, come prima di OPS-T01a. */
  function dockerCall(environment: 'test' | 'prod'): string[] {
    return [
      `ENV_DIR=${ROOT}/infra/env.example`,
      'APP_TAG=check-ports',
      'CADDY_TAG=check-ports',
      'POSTGRES_TAG=check-ports',
      'compose',
      '-p',
      'app',
      '--project-directory',
      ROOT,
      '-f',
      `${ROOT}/infra/compose.yml`,
      '-f',
      `${ROOT}/infra/compose.${environment}.yml`,
      '--profile',
      'tools',
      'config',
      '--format',
      'json',
    ];
  }

  /** La configurazione di oggi, prima di OPS-T01a: senza pgbackrest-init, senza attese e senza il volume pgsocket. */
  function configBeforeOpsT01a(): Config {
    const config = validConfig();
    delete config.services[INIT];
    for (const name of WAITING_SERVICES) delete field(config, name, 'depends_on')[INIT];
    service(config, 'postgres').volumes = volumesWithout(config, 'postgres', 'pgsocket');
    delete config.volumes.pgsocket;
    return config;
  }

  it('OPS-001: calcola una volta la configurazione di ogni ambiente e la passa ai due controlli; se va, termina con 0 e le righe OK', () => {
    const result = runCheckPorts(validConfig(), validConfig());
    expect(result.dockerCalls).toEqual([dockerCall('test'), dockerCall('prod')]);
    expect(result.status).toBe(0);
    expect(result.stdoutLines).toHaveLength(5);
    expect(result.stdoutLines[0]).toMatch(/^OK: .*\(test\)/);
    expect(result.stdoutLines[1]).toBe('OK: pgbackrest-init (test) senza problemi.');
    expect(result.stdoutLines[2]).toMatch(/^OK: .*\(prod\)/);
    expect(result.stdoutLines[3]).toBe('OK: pgbackrest-init (prod) senza problemi.');
    expect(result.stdoutLines[4]).toMatch(/^OK: .*pgbackrest-init/);
    expectNoValues(result.stdout + result.stderr);
  });

  it('OPS-001: senza pgbackrest-init (la configurazione prima di OPS-T01a) termina con 1, anche se check-compose.ts non trova problemi', () => {
    const result = runCheckPorts(configBeforeOpsT01a(), configBeforeOpsT01a());
    expect(result.dockerCalls).toEqual([dockerCall('test'), dockerCall('prod')]);
    expect(result.status).toBe(1);
    // Solo le righe OK di check-compose.ts, una per ambiente: nessuna di pgbackrest-init, nessuna riga OK finale.
    expect(result.stdoutLines).toHaveLength(2);
    expect(result.stdoutLines[0]).toMatch(/^OK: .*\(test\)/);
    expect(result.stdoutLines[1]).toMatch(/^OK: .*\(prod\)/);
    const errorLines = result.stderr.split('\n');
    for (const environment of ['test', 'prod']) {
      expect(errorLines).toContain(`Configurazione Compose (${environment}), pgbackrest-init: 5 problemi.`);
    }
    expect(errorLines.filter((line) => line === '- manca il servizio pgbackrest-init (OPS-001)')).toHaveLength(2);
    expectNoValues(result.stdout + result.stderr);
  });

  it('OPS-001: esegue il controllo di pgbackrest-init anche quando check-compose.ts trova problemi, prosegue con l’altro ambiente e termina con 1', () => {
    const broken = validConfig();
    service(broken, 'app').ports = [tcp(3000)];
    const result = runCheckPorts(broken, validConfig());
    expect(result.dockerCalls).toEqual([dockerCall('test'), dockerCall('prod')]);
    expect(result.status).toBe(1);
    expect(result.stdoutLines).toHaveLength(3);
    expect(result.stdoutLines[0]).toBe('OK: pgbackrest-init (test) senza problemi.');
    expect(result.stdoutLines[1]).toMatch(/^OK: .*\(prod\)/);
    expect(result.stdoutLines[2]).toBe('OK: pgbackrest-init (prod) senza problemi.');
    // I problemi che check-compose.ts trova in test (la porta pubblicata da app, FON-008), sullo standard error.
    expect(result.stderr).toMatch(/\(test\)/);
    expectNoValues(result.stdout + result.stderr);
  });
});
