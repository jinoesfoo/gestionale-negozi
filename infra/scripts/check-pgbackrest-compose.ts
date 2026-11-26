// Controllo del servizio una tantum pgbackrest-init nella configurazione Compose dei server (OPS-001; 08 §pgBackRest,
// «Primo avvio», e OPS-T01a, note del piano, «infra/compose.yml»; 01 §Servizi Docker Compose, riga di pgbackrest-init,
// e §Variabili d'ambiente, servizio postgres): lo lancia infra/check-ports.sh, una volta per ambiente, dopo
// infra/scripts/check-compose.ts e sulla stessa uscita di
// `docker compose -f infra/compose.yml -f infra/compose.<ambiente>.yml --profile tools config --format json`,
// calcolata con i file di ambiente di esempio (infra/env.example/). Legge la configurazione dallo standard input e
// termina con 1 se trova un problema. Scrive solo nomi di servizi, volumi e variabili, mai i valori (né delle variabili
// né delle immagini). Reti, log, porte e restart dei servizi sempre attivi li controlla check-compose.ts, per tutti i
// servizi compreso pgbackrest-init: qui non si ripetono.
//
//   node infra/scripts/check-pgbackrest-compose.ts <ambiente> < configurazione.json
//
// Node 24 esegue il file senza compilarlo (solo tipi da togliere: niente enum né altra sintassi solo TypeScript).
import { readFileSync } from 'node:fs';

/** Il servizio una tantum che crea la stanza e controlla l'archiviazione prima che partano app e worker. */
const INIT = 'pgbackrest-init';

/**
 * Le sei variabili di pgBackRest di postgres.env (01 §Variabili d'ambiente, servizio postgres): endpoint, bucket,
 * regione e chiavi del bucket dei backup e repo1-cipher-pass, che pgBackRest legge dall'ambiente (08 §pgBackRest).
 */
const PGBACKREST_VARIABLES = [
  'PGBACKREST_REPO1_S3_ENDPOINT',
  'PGBACKREST_REPO1_S3_BUCKET',
  'PGBACKREST_REPO1_S3_REGION',
  'PGBACKREST_REPO1_S3_KEY',
  'PGBACKREST_REPO1_S3_KEY_SECRET',
  'PGBACKREST_REPO1_CIPHER_PASS',
];

/** Gli unici servizi con variabili PGBACKREST_*: tutti e due leggono postgres.env. */
const PGBACKREST_SERVICES = ['postgres', INIT];

/** I servizi sempre attivi che partono solo dopo la fine riuscita di pgbackrest-init (01 §Servizi Docker Compose). */
const WAITING_SERVICES = ['app', 'worker'];

interface NamedVolume {
  source: string;
  target: string;
}

/** I dati di PostgreSQL, con il file indicatore, montati allo stesso percorso in postgres e in pgbackrest-init. */
const PGDATA: NamedVolume = { source: 'pgdata', target: '/var/lib/postgresql' };

/** Il socket di PostgreSQL, condiviso: pgBackRest senza host remoto si collega al socket locale. */
const PGSOCKET: NamedVolume = { source: 'pgsocket', target: '/var/run/postgresql' };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectOrEmpty(value: unknown): Json {
  return isObject(value) ? value : {};
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Se il servizio monta il volume con nome, nella forma lunga che scrive `docker compose config`. */
function mounts(service: Json, volume: NamedVolume): boolean {
  return arrayOrEmpty(service.volumes)
    .map(objectOrEmpty)
    .some((mount) => mount.type === 'volume' && mount.source === volume.source && mount.target === volume.target);
}

/** La condizione di `depends_on` del servizio verso `dependency` (undefined se non ne dipende). */
function conditionOn(service: Json, dependency: string): unknown {
  return objectOrEmpty(objectOrEmpty(service.depends_on)[dependency]).condition;
}

/** I nomi delle variabili d'ambiente del servizio: Compose scrive in `environment` anche quelle di `env_file`. */
function variablesOf(service: Json): string[] {
  return Object.keys(objectOrEmpty(service.environment));
}

/** Le regole del servizio pgbackrest-init (01 §Servizi Docker Compose; 08, OPS-T01a, note del piano). */
function checkInit(init: Json, postgres: Json, problems: string[]): void {
  const image = init.image;
  if (typeof image !== 'string' || image === '' || image !== postgres.image) {
    problems.push(`${INIT}: l'immagine deve essere quella di postgres (frammento x-postgres-image) (OPS-001)`);
  }
  const command = init.command;
  if (!Array.isArray(command) || command.length !== 1 || command[0] !== INIT) {
    problems.push(`${INIT}: il comando deve essere [${INIT}] (OPS-001)`);
  }
  if (init.user !== 'postgres') problems.push(`${INIT}: deve girare con l'utente postgres (OPS-001)`);
  if (init.restart !== 'no') {
    problems.push(`${INIT}: deve avere restart "no", perché è un servizio una tantum (OPS-001)`);
  }
  if (conditionOn(init, 'postgres') !== 'service_healthy') {
    problems.push(`${INIT}: deve aspettare postgres in salute (depends_on postgres: service_healthy) (OPS-001)`);
  }
  if (objectOrEmpty(init.healthcheck).disable !== true) {
    problems.push(
      `${INIT}: deve avere healthcheck disable: true, perché quello dell'immagine è di PostgreSQL (OPS-001)`,
    );
  }
  for (const volume of [PGDATA, PGSOCKET]) {
    if (!mounts(init, volume)) problems.push(`${INIT}: manca il volume ${volume.source} su ${volume.target} (OPS-001)`);
  }
}

/** Le variabili PGBACKREST_*: le sei in postgres e in pgbackrest-init, nessuna negli altri servizi. */
function checkEnvironment(services: Json, problems: string[]): void {
  for (const name of PGBACKREST_SERVICES) {
    // Senza pgbackrest-init basta il problema del servizio mancante.
    if (name === INIT && !isObject(services[INIT])) continue;
    const present = variablesOf(objectOrEmpty(services[name]));
    const missing = PGBACKREST_VARIABLES.filter((variable) => !present.includes(variable));
    if (missing.length > 0) {
      // In postgres le usano l'archiviazione dei WAL (OPS-001) e i backup lanciati con exec da backup.sh (OPS-002).
      const requirements = name === 'postgres' ? 'OPS-001, OPS-002' : 'OPS-001';
      problems.push(`${name}: variabili di pgBackRest assenti dall'ambiente: ${missing.join(', ')} (${requirements})`);
    }
  }
  for (const [name, service] of Object.entries(services)) {
    if (PGBACKREST_SERVICES.includes(name)) continue;
    const found = variablesOf(objectOrEmpty(service)).filter((variable) => variable.startsWith('PGBACKREST_'));
    if (found.length > 0) {
      problems.push(
        `${name}: riceve ${found.join(', ')}, ma le variabili PGBACKREST_* sono solo di postgres e ${INIT} (OPS-001)`,
      );
    }
  }
}

/** I problemi di pgbackrest-init nella configurazione risolta da `docker compose config --format json`; vuoto se va. */
export function findPgbackrestProblems(config: unknown): string[] {
  const problems: string[] = [];
  const services = objectOrEmpty(objectOrEmpty(config).services);
  const volumes = objectOrEmpty(objectOrEmpty(config).volumes);
  const postgres = objectOrEmpty(services.postgres);
  const init = services[INIT];

  if (isObject(init)) {
    checkInit(init, postgres, problems);
  } else {
    // Senza il servizio le sue altre regole non si controllano: basta questo problema.
    problems.push(`manca il servizio ${INIT} (OPS-001)`);
  }
  if (!mounts(postgres, PGSOCKET)) {
    problems.push(
      `postgres: manca il volume ${PGSOCKET.source} su ${PGSOCKET.target}, condiviso con ${INIT} (OPS-001)`,
    );
  }
  for (const name of WAITING_SERVICES) {
    if (conditionOn(objectOrEmpty(services[name]), INIT) !== 'service_completed_successfully') {
      problems.push(
        `${name}: deve aspettare la fine riuscita di ${INIT} (depends_on ${INIT}: service_completed_successfully) (OPS-001)`,
      );
    }
  }
  if (Object.hasOwn(objectOrEmpty(objectOrEmpty(services.migrate).depends_on), INIT)) {
    problems.push(`migrate: non deve dipendere da ${INIT} (OPS-001)`);
  }
  if (!isObject(volumes[PGSOCKET.source])) {
    problems.push(`manca il volume ${PGSOCKET.source} fra i volumi del progetto (OPS-001)`);
  }
  checkEnvironment(services, problems);
  return problems;
}

if (import.meta.main) {
  const label = process.argv[2] ?? 'senza nome';
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    // Il messaggio di JSON.parse riporta un pezzo del testo, che può contenere valori: non si scrive.
    console.error(`Configurazione Compose (${label}), ${INIT}: lo standard input non è JSON valido.`);
    process.exit(1);
  }
  const problems = findPgbackrestProblems(config);
  if (problems.length > 0) {
    console.error(`Configurazione Compose (${label}), ${INIT}: ${problems.length} problemi.`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log(`OK: ${INIT} (${label}) senza problemi.`);
}
