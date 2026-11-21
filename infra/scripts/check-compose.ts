// Controllo della configurazione Compose dei server (01 §Servizi Docker Compose, FON-T06): lo lancia
// infra/check-ports.sh, una volta per ambiente, sull'uscita di
// `docker compose -f infra/compose.yml -f infra/compose.<ambiente>.yml --profile tools config --format json`,
// calcolata con i file di ambiente di esempio (infra/env.example/). Legge la configurazione dallo standard input e
// termina con 1 se trova un problema. Scrive solo nomi di servizi, reti, variabili e cartelle, mai i valori delle
// variabili.
//
//   node infra/scripts/check-compose.ts <ambiente> < configurazione.json
//
// Node 24 esegue il file senza compilarlo (solo tipi da togliere: niente enum né altra sintassi solo TypeScript).
import { existsSync, readFileSync } from 'node:fs';

/** I servizi che la configurazione dei server deve avere (01 §Servizi Docker Compose). */
export const REQUIRED_SERVICES = ['caddy', 'app', 'worker', 'migrate', 'postgres'];

/** Servizi sempre attivi: si riavviano da soli (01 §Servizi Docker Compose). */
const ALWAYS_RUNNING = ['caddy', 'app', 'worker', 'postgres'];

/** Le sole porte pubblicate, tutte di caddy, solo TCP (FON-008: HTTP/3 è disattivato). */
const CADDY_PORTS = [80, 443];

/** Rotazione dei log di ogni servizio (FON-010). */
const LOGGING = { driver: 'json-file', maxSize: '10m', maxFile: '5' };

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

/** Le porte pubblicate di un servizio, nella forma lunga che scrive `docker compose config`. */
function portsOf(service: Json): Json[] {
  return arrayOrEmpty(service.ports).map(objectOrEmpty);
}

function checkPorts(name: string, service: Json, problems: string[]): void {
  const ports = portsOf(service);
  if (name !== 'caddy') {
    if (ports.length > 0) problems.push(`${name}: pubblica porte, ma solo caddy può farlo (FON-008)`);
    return;
  }
  const seen = new Set<number>();
  for (const port of ports) {
    const target = Number(port.target);
    const allowed =
      CADDY_PORTS.includes(target) && String(port.published) === String(target) && port.protocol === 'tcp';
    if (!allowed) {
      problems.push(
        `caddy: porta non ammessa (${String(port.published)}→${String(port.target)}/${String(port.protocol)}): solo 80 e 443 in TCP (FON-008)`,
      );
    } else {
      seen.add(target);
    }
  }
  for (const target of CADDY_PORTS) {
    if (!seen.has(target)) problems.push(`caddy: manca la porta ${target} in TCP (FON-008)`);
  }
}

function checkNetworks(name: string, service: Json, problems: string[]): void {
  if (service.network_mode !== undefined) {
    problems.push(`${name}: usa network_mode, ma ogni servizio deve stare sulle reti del progetto (FON-008)`);
  }
  const networks = Object.keys(objectOrEmpty(service.networks)).sort();
  const expected = name === 'caddy' ? ['edge', 'internal'] : ['internal'];
  if (networks.join(',') !== expected.join(',')) {
    problems.push(`${name}: reti [${networks.join(', ')}], attese [${expected.join(', ')}] (FON-008)`);
  }
}

function checkLogging(name: string, service: Json, problems: string[]): void {
  const logging = objectOrEmpty(service.logging);
  const options = objectOrEmpty(logging.options);
  const ok =
    logging.driver === LOGGING.driver &&
    String(options['max-size']) === LOGGING.maxSize &&
    String(options['max-file']) === LOGGING.maxFile;
  if (!ok) {
    problems.push(`${name}: i log devono essere json-file con max-size 10m e max-file 5 (FON-010)`);
  }
}

function checkOwnerUrl(name: string, service: Json, problems: string[]): void {
  const hasOwnerUrl = Object.hasOwn(objectOrEmpty(service.environment), 'DATABASE_OWNER_URL');
  if (name === 'migrate' && !hasOwnerUrl) {
    problems.push(
      'migrate: manca DATABASE_OWNER_URL (i file di ambiente non sono stati letti, e il controllo sarebbe vuoto)',
    );
  }
  if (name !== 'migrate' && hasOwnerUrl) {
    problems.push(`${name}: riceve DATABASE_OWNER_URL, che è solo di migrate (FON-002)`);
  }
}

function checkBindMounts(name: string, service: Json, problems: string[]): void {
  for (const volume of arrayOrEmpty(service.volumes).map(objectOrEmpty)) {
    if (volume.type === 'bind' && !(typeof volume.source === 'string' && existsSync(volume.source))) {
      problems.push(`${name}: la cartella montata ${String(volume.source)} non esiste`);
    }
  }
}

/** I problemi della configurazione risolta da `docker compose config --format json`; vuoto se è corretta. */
export function findProblems(config: unknown): string[] {
  const problems: string[] = [];
  const services = objectOrEmpty(objectOrEmpty(config).services);
  const networks = objectOrEmpty(objectOrEmpty(config).networks);

  for (const name of REQUIRED_SERVICES) {
    if (!isObject(services[name])) problems.push(`manca il servizio ${name}`);
  }
  if (!isObject(networks.edge)) problems.push('manca la rete edge (FON-008)');
  if (!isObject(networks.internal)) problems.push('manca la rete internal (FON-008)');
  if (objectOrEmpty(networks.internal).internal === true) {
    problems.push('la rete internal non può essere internal: true: bloccherebbe le connessioni in uscita (FON-008)');
  }

  for (const [name, value] of Object.entries(services)) {
    const service = objectOrEmpty(value);
    checkPorts(name, service, problems);
    checkNetworks(name, service, problems);
    checkLogging(name, service, problems);
    checkOwnerUrl(name, service, problems);
    checkBindMounts(name, service, problems);
  }

  const caddy = objectOrEmpty(services.caddy);
  if (caddy.depends_on !== undefined) {
    problems.push('caddy: non deve avere depends_on (DOM-T02 lo avvia da solo)');
  }
  const migrate = objectOrEmpty(services.migrate);
  if (isObject(services.migrate)) {
    if (!arrayOrEmpty(migrate.profiles).includes('tools')) problems.push('migrate: deve stare nel profilo tools');
    if (migrate.restart !== 'no') problems.push('migrate: deve avere restart "no"');
  }
  for (const name of ALWAYS_RUNNING) {
    const service = services[name];
    if (isObject(service) && service.restart !== 'unless-stopped') {
      problems.push(`${name}: deve avere restart unless-stopped`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const label = process.argv[2] ?? 'senza nome';
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    // Il messaggio di JSON.parse riporta un pezzo del testo, che può contenere valori: non si scrive.
    console.error(`Configurazione Compose (${label}): lo standard input non è JSON valido.`);
    process.exit(1);
  }
  const problems = findProblems(config);
  if (problems.length > 0) {
    console.error(`Configurazione Compose (${label}): ${problems.length} problemi.`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log(`OK: configurazione Compose (${label}) senza problemi.`);
}
