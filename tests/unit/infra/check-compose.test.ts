import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findProblems, REQUIRED_SERVICES } from '../../../infra/scripts/check-compose';

// Il controllo che infra/check-ports.sh esegue sull'uscita di `docker compose config --format json` (FON-T06), provato
// su configurazioni scritte qui, nella forma risolta che scrive Compose (porte in forma lunga con `published` come
// testo, `environment` come mappa, cartelle montate con il percorso assoluto). Lo script vero, con Docker, lo esegue
// l'utente (docs/verifiche/fon-t06.md) e, da FON-T08, la CI.

const CHECKER = fileURLToPath(new URL('../../../infra/scripts/check-compose.ts', import.meta.url));
const INIT_DIR = fileURLToPath(new URL('../../../infra/postgres/init', import.meta.url));
const OWNER_URL = 'postgres://app_owner:VALORE-PROVA-PW-OWNER@postgres:5432/app';

type Service = Record<string, unknown>;
interface Config {
  name: string;
  services: Record<string, Service>;
  networks: Record<string, Record<string, unknown>>;
  volumes: Record<string, Record<string, unknown>>;
}

const logging = () => ({ driver: 'json-file', options: { 'max-file': '5', 'max-size': '10m' } });
const tcp = (port: number) => ({ mode: 'ingress', target: port, published: String(port), protocol: 'tcp' });
const healthyPostgres = () => ({ postgres: { condition: 'service_healthy', required: true } });

/** Una configurazione corretta, come la scriverebbe `docker compose config --format json`. */
function validConfig(): Config {
  return {
    name: 'app',
    networks: { edge: { name: 'app_edge', ipam: {} }, internal: { name: 'app_internal', ipam: {} } },
    services: {
      caddy: {
        image: 'ghcr.io/jinoesfoo/gestionale-negozi-caddy:check-ports',
        environment: { CF_API_TOKEN: 'VALORE-PROVA-CLOUDFLARE' },
        networks: { edge: null, internal: null },
        ports: [tcp(80), tcp(443)],
        restart: 'unless-stopped',
        logging: logging(),
        volumes: [
          { type: 'volume', source: 'caddy_data', target: '/data', volume: {} },
          { type: 'volume', source: 'caddy_config', target: '/config', volume: {} },
        ],
      },
      app: {
        image: 'ghcr.io/jinoesfoo/gestionale-negozi-app:check-ports',
        environment: { DATABASE_URL: 'postgres://app_user:VALORE-PROVA-PW-USER@postgres:5432/app' },
        networks: { internal: null },
        depends_on: healthyPostgres(),
        restart: 'unless-stopped',
        logging: logging(),
      },
      worker: {
        image: 'ghcr.io/jinoesfoo/gestionale-negozi-app:check-ports',
        command: ['node', 'dist/worker.js'],
        environment: { DATABASE_URL: 'postgres://app_worker:VALORE-PROVA-PW-WORKER@postgres:5432/app' },
        networks: { internal: null },
        depends_on: healthyPostgres(),
        restart: 'unless-stopped',
        logging: logging(),
      },
      migrate: {
        image: 'ghcr.io/jinoesfoo/gestionale-negozi-app:check-ports',
        command: ['node', 'dist/migrate.js'],
        profiles: ['tools'],
        environment: { DATABASE_OWNER_URL: OWNER_URL },
        networks: { internal: null },
        depends_on: healthyPostgres(),
        restart: 'no',
        logging: logging(),
      },
      postgres: {
        image: 'ghcr.io/jinoesfoo/gestionale-negozi-postgres:check-ports',
        environment: { POSTGRES_DB: 'app', POSTGRES_PASSWORD: 'VALORE-PROVA-PW-POSTGRES' },
        networks: { internal: null },
        restart: 'unless-stopped',
        logging: logging(),
        volumes: [
          { type: 'volume', source: 'pgdata', target: '/var/lib/postgresql', volume: {} },
          { type: 'bind', source: INIT_DIR, target: '/docker-entrypoint-initdb.d', read_only: true, bind: {} },
        ],
      },
    },
    volumes: {
      caddy_data: { name: 'app_caddy_data' },
      caddy_config: { name: 'app_caddy_config' },
      pgdata: { name: 'app_pgdata' },
    },
  };
}

/** Una configurazione corretta con una modifica, e i suoi problemi. */
function problemsWith(change: (config: Config) => void): string[] {
  const config = validConfig();
  change(config);
  return findProblems(config);
}

function service(config: Config, name: string): Service {
  const found = config.services[name];
  if (!found) throw new Error(`servizio ${name} assente dalla configurazione di prova`);
  return found;
}

const NOT_CADDY = ['app', 'worker', 'migrate', 'postgres'];

describe('controllo della configurazione Compose (infra/scripts/check-compose.ts)', () => {
  it('FON-008: la configurazione corretta non ha problemi', () => {
    expect(findProblems(validConfig())).toEqual([]);
  });

  it('FON-006: i servizi richiesti sono quelli di 01 §Servizi Docker Compose', () => {
    expect([...REQUIRED_SERVICES].sort()).toEqual(['app', 'caddy', 'migrate', 'postgres', 'worker']);
  });

  it.each(REQUIRED_SERVICES)('FON-006: senza il servizio %s la configurazione è sbagliata', (name) => {
    const problems = problemsWith((config) => delete config.services[name]);
    expect(problems.join('\n')).toContain(name);
  });

  it.each(NOT_CADDY)('FON-008: una porta pubblicata da %s è un problema', (name) => {
    const problems = problemsWith((config) => (service(config, name).ports = [tcp(3000)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
  });

  it('FON-008: caddy pubblica solo 80 e 443, solo in TCP', () => {
    const udp = problemsWith(
      (config) => (service(config, 'caddy').ports = [tcp(80), tcp(443), { ...tcp(443), protocol: 'udp' }]),
    );
    expect(udp.join('\n')).toContain('caddy');
    expect(problemsWith((config) => (service(config, 'caddy').ports = [tcp(80), tcp(443), tcp(8080)]))).not.toEqual([]);
    expect(problemsWith((config) => (service(config, 'caddy').ports = [tcp(80)]))).not.toEqual([]);
    expect(
      problemsWith((config) => (service(config, 'caddy').ports = [tcp(80), { ...tcp(443), published: '8443' }])),
    ).not.toEqual([]);
  });

  it('FON-008: un servizio con network_mode (per esempio host) è un problema', () => {
    const problems = problemsWith((config) => (service(config, 'app').network_mode = 'host'));
    expect(problems.join('\n')).toContain('app');
  });

  it('FON-008: la rete internal non può essere internal: true', () => {
    const problems = problemsWith((config) => {
      config.networks.internal = { ...config.networks.internal, internal: true };
    });
    expect(problems.join('\n')).toContain('internal');
  });

  it.each(NOT_CADDY)('FON-008: %s sta solo sulla rete internal', (name) => {
    const problems = problemsWith((config) => (service(config, name).networks = { edge: null, internal: null }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
  });

  it('FON-008: caddy sta sulle reti edge e internal', () => {
    expect(problemsWith((config) => (service(config, 'caddy').networks = { internal: null }))).not.toEqual([]);
    expect(problemsWith((config) => (service(config, 'caddy').networks = { edge: null }))).not.toEqual([]);
  });

  it.each(REQUIRED_SERVICES)('FON-010: %s ha i log json-file con al massimo 5 file da 10 MB', (name) => {
    expect(problemsWith((config) => delete service(config, name).logging)).toHaveLength(1);
    expect(problemsWith((config) => (service(config, name).logging = { driver: 'local' }))).toHaveLength(1);
    expect(
      problemsWith(
        (config) =>
          (service(config, name).logging = { driver: 'json-file', options: { 'max-size': '20m', 'max-file': '5' } }),
      ),
    ).toHaveLength(1);
    expect(
      problemsWith(
        (config) => (service(config, name).logging = { driver: 'json-file', options: { 'max-size': '10m' } }),
      ),
    ).toHaveLength(1);
  });

  it.each(['app', 'worker', 'caddy', 'postgres'])(
    'FON-002: DATABASE_OWNER_URL nell’ambiente di %s è un problema, scritto senza il valore',
    (name) => {
      const problems = problemsWith((config) => {
        service(config, name).environment = {
          ...(service(config, name).environment as object),
          DATABASE_OWNER_URL: OWNER_URL,
        };
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(name);
      expect(problems[0]).toContain('DATABASE_OWNER_URL');
      expect(problems[0]).not.toContain(OWNER_URL);
    },
  );

  it('FON-002: DATABASE_OWNER_URL anche vuota nell’ambiente di app è un problema', () => {
    const problems = problemsWith((config) => (service(config, 'app').environment = { DATABASE_OWNER_URL: '' }));
    expect(problems.join('\n')).toContain('DATABASE_OWNER_URL');
  });

  it('FON-002: migrate senza DATABASE_OWNER_URL è un problema (i file di ambiente non sono stati letti)', () => {
    const problems = problemsWith((config) => (service(config, 'migrate').environment = {}));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('migrate');
  });

  it('FON-006: caddy non ha depends_on (DOM-T02 lo avvia da solo)', () => {
    const problems = problemsWith(
      (config) => (service(config, 'caddy').depends_on = { app: { condition: 'service_started' } }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('caddy');
  });

  it('FON-006: migrate sta nel profilo tools e non si riavvia (restart "no")', () => {
    expect(problemsWith((config) => delete service(config, 'migrate').profiles)).toHaveLength(1);
    expect(problemsWith((config) => (service(config, 'migrate').restart = 'unless-stopped'))).toHaveLength(1);
    expect(problemsWith((config) => delete service(config, 'migrate').restart)).toHaveLength(1);
  });

  it.each(['caddy', 'app', 'worker', 'postgres'])('FON-006: %s ha restart unless-stopped', (name) => {
    expect(problemsWith((config) => delete service(config, name).restart)).toHaveLength(1);
    expect(problemsWith((config) => (service(config, name).restart = 'always'))).toHaveLength(1);
  });

  it('FON-006: una cartella montata che non esiste è un problema', () => {
    const missing = `${INIT_DIR}-che-non-esiste`;
    const problems = problemsWith((config) => {
      const volumes = service(config, 'postgres').volumes as Record<string, unknown>[];
      volumes[1] = { ...volumes[1], source: missing };
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(missing);
  });

  it('FON-008: un servizio in più (per esempio pgbackrest-init di OPS-T01a) segue le stesse regole', () => {
    const extra = (config: Config) => ({
      ...service(config, 'migrate'),
      environment: {},
      profiles: undefined,
      restart: 'no',
    });
    expect(problemsWith((config) => (config.services['pgbackrest-init'] = extra(config)))).toEqual([]);
    expect(
      problemsWith((config) => (config.services['pgbackrest-init'] = { ...extra(config), ports: [tcp(8432)] })),
    ).toHaveLength(1);
  });
});

describe('controllo della configurazione Compose da riga di comando', () => {
  function runChecker(input: string) {
    const result = spawnSync(process.execPath, [CHECKER, 'test'], { input, encoding: 'utf8', timeout: 30_000 });
    if (result.error) throw result.error;
    return result;
  }

  it('FON-008: legge la configurazione dallo standard input: 0 e una riga OK se è corretta', () => {
    const result = runChecker(JSON.stringify(validConfig()));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK');
  });

  it('FON-008: con un problema termina con 1 e lo elenca, senza scrivere valori', () => {
    const config = validConfig();
    service(config, 'app').ports = [tcp(3000)];
    service(config, 'worker').environment = { DATABASE_OWNER_URL: OWNER_URL };
    const result = runChecker(JSON.stringify(config));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('app');
    expect(result.stderr).toContain('DATABASE_OWNER_URL');
    expect(result.stdout + result.stderr).not.toContain('VALORE-PROVA');
  });

  it('FON-008: uno standard input che non è JSON termina con 1, senza ripeterne il contenuto', () => {
    const result = runChecker('non è json: VALORE-PROVA-SEGRETO');
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain('VALORE-PROVA-SEGRETO');
  });
});
