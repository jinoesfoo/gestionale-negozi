import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// L'immagine PostgreSQL con pgBackRest e l'archiviazione dei WAL (08 OPS-001 e OPS-002; 08 §pgBackRest e OPS-T01a,
// note del piano «Configurazione», «Pacchetti», «Script nell'immagine», «infra/compose.yml» e «Tag»; 01 §Servizi
// Docker Compose, riga di pgbackrest-init, e FON-T03 per le parti che restano), letta come testo:
// infra/postgres/Dockerfile, pgbackrest.conf e postgresql.conf, infra/compose.dev.yml, infra/versions.env e
// infra/compose.yml. Ogni controllo è una funzione che restituisce i problemi di un testo (nessuno se rispetta la
// specifica): i test sui file del repository vogliono l'elenco vuoto, e i test «del controllo» provano la stessa
// funzione su varianti scritte qui, ammesse (nessun problema) e vietate (fra i problemi c'è quello della regola
// toccata). La configurazione risolta da Compose la controlla infra/scripts/check-pgbackrest-compose.ts; gli script
// dell'immagine si provano nei loro test, con programmi finti; la costruzione, i file dentro l'immagine e pgBackRest
// vero contro l'emulatore stanno nella lista di controllo docs/verifiche/ops-t01a.md (C1-C5) e in
// tests/infra/pgbackrest/run.sh.

const ROOT = new URL('../../../', import.meta.url);
const DOCKERFILE = 'infra/postgres/Dockerfile';
const PGBACKREST_CONF = 'infra/postgres/pgbackrest.conf';
const POSTGRESQL_CONF = 'infra/postgres/postgresql.conf';
const COMPOSE_DEV = 'infra/compose.dev.yml';
const COMPOSE = 'infra/compose.yml';
const VERSIONS = 'infra/versions.env';
const IMAGE_SCRIPTS = ['infra/postgres/pgbackrest-summary', 'infra/postgres/pgbackrest-init'];

function repoPath(path: string): string {
  return fileURLToPath(new URL(path, ROOT));
}

/** Il testo di un file del repository; se il file manca, il test fallisce con il suo nome. */
function read(path: string): string {
  expect(existsSync(repoPath(path)), `manca il file ${path}`).toBe(true);
  return readFileSync(repoPath(path), 'utf8');
}

/** Una variante di un testo di prova: ogni coppia sostituisce un pezzo che deve comparire una volta sola. */
type Change = [from: string, to: string];
/** Una variante ammessa dalla specifica. */
type Accepted = [label: string, changes: Change[]];
/** Una variante vietata, con il pezzo di testo del problema che il controllo deve trovare. */
type Rejected = [label: string, changes: Change[], problem: string];

function applyChanges(base: string, changes: Change[]): string {
  return changes.reduce((text, [from, to]) => {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`variante di prova sbagliata: «${from}» compare ${count} volte`);
    return text.replace(from, () => to);
  }, base);
}

/** Fra i problemi c'è quello della regola toccata dalla variante, non uno qualsiasi. */
function expectProblem(problems: string[], problem: string): void {
  expect(
    problems.filter((found) => found.includes(problem)),
    `atteso un problema con «${problem}»; trovati: ${JSON.stringify(problems)}`,
  ).not.toEqual([]);
}

// --- Dockerfile ------------------------------------------------------------------------------------------------------

/**
 * Le istruzioni di un Dockerfile, come le legge Docker: le righe di commento si tolgono anche in mezzo a un'istruzione
 * continuata, una riga che finisce con `\` continua nella successiva, gli spazi si riducono a uno, le righe vuote si
 * tolgono e la parola chiave si scrive in maiuscolo.
 */
function dockerInstructions(text: string): string[] {
  const instructions: string[] = [];
  let pending: string | null = null;
  const finish = (instruction: string) =>
    instructions.push(
      instruction
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\S+/, (word) => word.toUpperCase()),
    );
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const continued = line.endsWith('\\');
    const body = continued ? line.slice(0, -1) : line;
    pending = pending === null ? body : `${pending} ${body}`;
    if (!continued) {
      finish(pending);
      pending = null;
    }
  }
  if (pending !== null) finish(pending);
  return instructions;
}

const keyword = (instruction: string): string => instruction.split(' ')[0] ?? '';
const withKeyword = (instructions: string[], name: string): string[] =>
  instructions.filter((instruction) => keyword(instruction) === name);

/** Un comando di shell di un'istruzione RUN: la RUN a cui appartiene e la posizione fra tutti i comandi del file. */
interface ShellCommand {
  run: number;
  order: number;
  words: string[];
}

/**
 * I comandi delle istruzioni RUN in forma shell, nell'ordine del file: ogni RUN divisa a `&&`, `||`, `;` e `|`, ogni
 * comando come elenco di parole, senza le opzioni di RUN (`--mount=…`) e senza le assegnazioni che lo precedono
 * (`DEBIAN_FRONTEND=noninteractive apt-get …`).
 */
function shellCommands(instructions: string[]): ShellCommand[] {
  const commands: ShellCommand[] = [];
  instructions.forEach((instruction, run) => {
    if (keyword(instruction) !== 'RUN') return;
    const body = instruction.replace(/^RUN(\s+--[a-z-]+=\S+)*\s+/, '');
    for (const part of body.split(/&&|\|\||;|\|/)) {
      const words = part.split(' ').filter((word) => word !== '');
      while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) words.shift();
      if (words.length > 0) commands.push({ run, order: commands.length, words });
    }
  });
  return commands;
}

const FROM = 'FROM postgres:18.7-trixie';

/** I pacchetti dell'immagine (08, note del piano di OPS-T01a, «Pacchetti»), in ordine alfabetico. */
const PACKAGES = ['ca-certificates', 'jq', 'pgbackrest'];

/**
 * Le istruzioni che OPS-T01a non cambia, copiate così come sono scritte nel Dockerfile di FON-T03: la label del
 * repository (01 §Servizi), le due COPY, il HEALTHCHECK in forma exec (nota (e) della fase codice di FON-T03) e il CMD.
 */
const UNCHANGED_DOCKERFILE_TEXT = `LABEL org.opencontainers.image.source="https://github.com/jinoesfoo/gestionale-negozi"
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY roles.sql.tpl /opt/roles.sql.tpl
HEALTHCHECK --interval=5s --timeout=10s --start-period=120s --retries=12 \\
  CMD ["pg_isready", "-q", "-t", "5", "-h", "127.0.0.1", "-U", "postgres", "-d", "app"]
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]`;

const CONF_COPY = /^COPY (--chmod=0?644 )?pgbackrest\.conf \/etc\/pgbackrest\/pgbackrest\.conf$/;
const SCRIPTS_COPY =
  /^COPY --chmod=0?755 (pgbackrest-summary pgbackrest-init|pgbackrest-init pgbackrest-summary) \/usr\/local\/bin\/$/;

const isAptInstall = (command: ShellCommand): boolean =>
  ['apt-get', 'apt', 'aptitude'].includes(command.words[0] ?? '') && command.words.includes('install');

function fromProblems(instructions: string[]): string[] {
  const froms = withKeyword(instructions, 'FROM');
  return froms.length === 1 && froms[0] === FROM ? [] : [`una sola fase, ${FROM}: trovati ${JSON.stringify(froms)}`];
}

/** pgbackrest, jq e ca-certificates, senza versioni fissate, in una RUN con apt-get update e la pulizia delle liste. */
function packageProblems(instructions: string[]): string[] {
  const commands = shellCommands(instructions);
  const installs = commands.filter(isAptInstall);
  const [install] = installs;
  if (install === undefined || installs.length !== 1) {
    return [`una sola installazione di pacchetti con apt-get install, trovate ${installs.length}`];
  }
  const problems: string[] = [];
  const sameRun = commands.filter((command) => command.run === install.run);
  if (install.words[0] !== 'apt-get')
    problems.push(`i pacchetti si installano con apt-get, non con ${install.words[0]}`);
  if (!sameRun.some((c) => c.words[0] === 'apt-get' && c.words.includes('update') && c.order < install.order)) {
    problems.push('manca apt-get update nella stessa RUN, prima di apt-get install');
  }
  if (
    !sameRun.some((c) => c.words[0] === 'rm' && c.words.includes('/var/lib/apt/lists/*') && c.order > install.order)
  ) {
    problems.push('manca la pulizia di /var/lib/apt/lists/* nella stessa RUN, dopo apt-get install');
  }
  const words = install.words.slice(1).filter((word) => word !== 'install');
  const options = words.filter((word) => word.startsWith('-'));
  const packages = words.filter((word) => !word.startsWith('-'));
  if (!options.includes('--no-install-recommends')) problems.push('apt-get install senza --no-install-recommends');
  const otherOptions = options.filter((option) => option !== '--no-install-recommends' && option !== '-y');
  if (otherOptions.length > 0) problems.push(`opzioni di apt-get install non previste: ${otherOptions.join(' ')}`);
  const pinned = packages.filter((name) => name.includes('='));
  if (pinned.length > 0) problems.push(`pacchetti con la versione fissata: ${pinned.join(' ')}`);
  if ([...packages].sort().join(' ') !== PACKAGES.join(' ')) {
    problems.push(`pacchetti installati: ${packages.join(' ')}; attesi esattamente pgbackrest, jq e ca-certificates`);
  }
  return problems;
}

/** Il file d'esempio del pacchetto si toglie con `rm -f /etc/pgbackrest.conf`, dopo l'installazione che lo porta. */
function sampleFileProblems(instructions: string[]): string[] {
  const commands = shellCommands(instructions);
  const removals = commands.filter((command) => command.words.join(' ') === 'rm -f /etc/pgbackrest.conf');
  if (removals.length === 0) return ['manca rm -f /etc/pgbackrest.conf (file d’esempio del pacchetto)'];
  const install = commands.find(isAptInstall);
  if (install !== undefined && !removals.some((command) => command.order > install.order)) {
    return ['rm -f /etc/pgbackrest.conf viene prima di apt-get install, che rimette il file'];
  }
  return [];
}

/** La configurazione in /etc/pgbackrest/ e i due script in /usr/local/bin/ con una sola COPY --chmod=755. */
function copyProblems(instructions: string[]): string[] {
  const copies = withKeyword(instructions, 'COPY');
  const problems: string[] = [];
  const conf = copies.filter((copy) => copy.includes('pgbackrest.conf'));
  if (conf.length !== 1 || !CONF_COPY.test(conf[0] ?? '')) {
    problems.push(
      `una COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf (--chmod=644 ammesso): ${JSON.stringify(conf)}`,
    );
  }
  const scripts = copies.filter((copy) => /pgbackrest-(summary|init)/.test(copy));
  if (scripts.length !== 1 || !SCRIPTS_COPY.test(scripts[0] ?? '')) {
    problems.push(
      `una sola COPY --chmod=755 di pgbackrest-summary e pgbackrest-init in /usr/local/bin/: ${JSON.stringify(scripts)}`,
    );
  }
  return problems;
}

/** Nessun ENTRYPOINT (resta quello dell'immagine di base) e nessuna variabile PGBACKREST nell'immagine (solo i nomi). */
function entrypointAndEnvProblems(instructions: string[]): string[] {
  const problems: string[] = [];
  const entrypoints = withKeyword(instructions, 'ENTRYPOINT');
  if (entrypoints.length > 0) problems.push(`ENTRYPOINT non previsto: ${entrypoints.length}`);
  const names = withKeyword(instructions, 'ENV').flatMap((env) => env.match(/PGBACKREST\w*/g) ?? []);
  if (names.length > 0) problems.push(`ENV con PGBACKREST: ${names.join(' ')}`);
  return problems;
}

function unchangedProblems(instructions: string[]): string[] {
  const [label, configCopy, rolesCopy, healthcheck, cmd] = dockerInstructions(UNCHANGED_DOCKERFILE_TEXT);
  const copies = withKeyword(instructions, 'COPY');
  const groups: [string | undefined, string[]][] = [
    [label, withKeyword(instructions, 'LABEL').filter((i) => i.includes('org.opencontainers.image.source'))],
    [configCopy, copies.filter((copy) => copy.includes('postgresql.conf'))],
    [rolesCopy, copies.filter((copy) => copy.includes('roles.sql.tpl'))],
    [healthcheck, withKeyword(instructions, 'HEALTHCHECK')],
    [cmd, withKeyword(instructions, 'CMD')],
  ];
  return groups.flatMap(([expected, found]) =>
    found.length === 1 && found[0] === expected
      ? []
      : [`atteso una volta ${expected}, trovati ${JSON.stringify(found)}`],
  );
}

function dockerfileProblems(text: string): string[] {
  const instructions = dockerInstructions(text);
  return [
    ...fromProblems(instructions),
    ...packageProblems(instructions),
    ...sampleFileProblems(instructions),
    ...copyProblems(instructions),
    ...entrypointAndEnvProblems(instructions),
    ...unchangedProblems(instructions),
  ];
}

/** La versione di PostgreSQL del FROM (`postgres:18.7-trixie` → `18.7`); vuota se il FROM ha un'altra forma. */
function postgresVersion(dockerfile: string): string {
  const from = withKeyword(dockerInstructions(dockerfile), 'FROM')[0] ?? '';
  return /^FROM postgres:(\d+\.\d+)-\S+$/.exec(from)?.[1] ?? '';
}

/** Un Dockerfile che rispetta la specifica, per provare i controlli (non è quello del repository). */
const SAMPLE_RUN = [
  'RUN apt-get update \\',
  '  && apt-get install -y --no-install-recommends pgbackrest jq ca-certificates \\',
  '  && rm -rf /var/lib/apt/lists/* \\',
  '  && rm -f /etc/pgbackrest.conf',
].join('\n');

const SAMPLE_DOCKERFILE = [
  '# Dockerfile di prova dei controlli.',
  'FROM postgres:18.7-trixie',
  '',
  'LABEL org.opencontainers.image.source="https://github.com/jinoesfoo/gestionale-negozi"',
  '',
  SAMPLE_RUN,
  '',
  'COPY postgresql.conf /etc/postgresql/postgresql.conf',
  'COPY roles.sql.tpl /opt/roles.sql.tpl',
  'COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf',
  'COPY --chmod=755 pgbackrest-summary pgbackrest-init /usr/local/bin/',
  '',
  'HEALTHCHECK --interval=5s --timeout=10s --start-period=120s --retries=12 \\',
  '  CMD ["pg_isready", "-q", "-t", "5", "-h", "127.0.0.1", "-U", "postgres", "-d", "app"]',
  '',
  'CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]',
  '',
].join('\n');

const DOCKERFILE_ACCEPTED: Accepted[] = [
  ['il Dockerfile di prova così com’è', []],
  [
    'i pacchetti in un altro ordine, senza -y',
    [
      [
        'install -y --no-install-recommends pgbackrest jq ca-certificates',
        'install --no-install-recommends ca-certificates jq pgbackrest',
      ],
    ],
  ],
  [
    '-y dopo --no-install-recommends, un pacchetto per riga e un commento dentro la RUN',
    [
      [
        SAMPLE_RUN,
        [
          'RUN apt-get update \\',
          '  # jq legge l’uscita JSON di pgbackrest info',
          '  && apt-get install --no-install-recommends -y \\',
          '    ca-certificates \\',
          '    jq \\',
          '    pgbackrest \\',
          '  && rm -rf /var/lib/apt/lists/* \\',
          '  && rm -f /etc/pgbackrest.conf',
        ].join('\n'),
      ],
    ],
  ],
  [
    'i comandi separati da punto e virgola e il file d’esempio tolto in una RUN successiva',
    [
      [
        SAMPLE_RUN,
        [
          'RUN set -eux; apt-get update; apt-get install -y --no-install-recommends pgbackrest jq ca-certificates; rm -rf /var/lib/apt/lists/*',
          'RUN rm -f /etc/pgbackrest.conf',
        ].join('\n'),
      ],
    ],
  ],
  [
    '&& in fondo alle righe e DEBIAN_FRONTEND=noninteractive davanti ad apt-get install',
    [
      [
        SAMPLE_RUN,
        [
          'RUN apt-get update && \\',
          '    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends pgbackrest jq ca-certificates && \\',
          '    rm -rf /var/lib/apt/lists/* && \\',
          '    rm -f /etc/pgbackrest.conf',
        ].join('\n'),
      ],
    ],
  ],
  ['COPY --chmod=644 della configurazione', [['COPY pgbackrest.conf', 'COPY --chmod=644 pgbackrest.conf']]],
  [
    'COPY --chmod=0644 e --chmod=0755, con gli script in un altro ordine',
    [
      ['COPY pgbackrest.conf', 'COPY --chmod=0644 pgbackrest.conf'],
      ['--chmod=755 pgbackrest-summary pgbackrest-init', '--chmod=0755 pgbackrest-init pgbackrest-summary'],
    ],
  ],
];

const DOCKERFILE_REJECTED: Rejected[] = [
  [
    'jq con la versione fissata (jq=1.7.1-6+deb13u4)',
    [[' jq ', ' jq=1.7.1-6+deb13u4 ']],
    'pacchetti con la versione fissata: jq=1.7.1-6+deb13u4',
  ],
  [
    'pgbackrest con la versione fissata (pgbackrest=2.60.1-*)',
    [['--no-install-recommends pgbackrest ', '--no-install-recommends pgbackrest=2.60.1-* ']],
    'pacchetti con la versione fissata: pgbackrest=2.60.1-*',
  ],
  [
    'un pacchetto in più (curl)',
    [['jq ca-certificates', 'jq ca-certificates curl']],
    'pacchetti installati: pgbackrest jq ca-certificates curl;',
  ],
  [
    'un pacchetto in meno (senza ca-certificates)',
    [[' jq ca-certificates', ' jq']],
    'pacchetti installati: pgbackrest jq;',
  ],
  [
    'apt-get install senza --no-install-recommends',
    [['install -y --no-install-recommends', 'install -y']],
    'apt-get install senza --no-install-recommends',
  ],
  [
    'le liste di apt non tolte',
    [['  && rm -rf /var/lib/apt/lists/* \\\n', '']],
    'manca la pulizia di /var/lib/apt/lists/*',
  ],
  [
    'le liste di apt tolte in un’altra RUN',
    [
      [
        '  && rm -rf /var/lib/apt/lists/* \\\n  && rm -f /etc/pgbackrest.conf',
        '  && rm -f /etc/pgbackrest.conf\nRUN rm -rf /var/lib/apt/lists/*',
      ],
    ],
    'manca la pulizia di /var/lib/apt/lists/*',
  ],
  [
    'apt-get update in un’altra RUN',
    [['RUN apt-get update \\\n  && apt-get install', 'RUN apt-get update\nRUN apt-get install']],
    'manca apt-get update nella stessa RUN',
  ],
  [
    'senza rm -f /etc/pgbackrest.conf',
    [[' \\\n  && rm -f /etc/pgbackrest.conf', '']],
    'manca rm -f /etc/pgbackrest.conf',
  ],
  [
    'rm -f /etc/pgbackrest.conf prima dell’installazione',
    [
      [' \\\n  && rm -f /etc/pgbackrest.conf', ''],
      ['RUN apt-get update', 'RUN rm -f /etc/pgbackrest.conf\nRUN apt-get update'],
    ],
    'rm -f /etc/pgbackrest.conf viene prima di apt-get install',
  ],
  [
    'una seconda installazione di pacchetti in un’altra RUN',
    [
      [
        'COPY postgresql.conf',
        'RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*\nCOPY postgresql.conf',
      ],
    ],
    'una sola installazione di pacchetti con apt-get install, trovate 2',
  ],
  [
    'due fasi (un secondo FROM)',
    [['FROM postgres:18.7-trixie', 'FROM debian:trixie AS prova\nFROM postgres:18.7-trixie']],
    'una sola fase',
  ],
  [
    'un’altra versione di PostgreSQL (postgres:18.6-trixie)',
    [['postgres:18.7-trixie', 'postgres:18.6-trixie']],
    'una sola fase',
  ],
  [
    'i pacchetti installati con apt invece che con apt-get',
    [['&& apt-get install', '&& apt install']],
    'i pacchetti si installano con apt-get, non con apt',
  ],
  [
    'un ENTRYPOINT',
    [['CMD ["postgres"', 'ENTRYPOINT ["docker-entrypoint.sh"]\nCMD ["postgres"']],
    'ENTRYPOINT non previsto',
  ],
  [
    'un entrypoint scritto in minuscolo (le parole chiave di Docker non distinguono maiuscole e minuscole)',
    [['CMD ["postgres"', 'entrypoint ["docker-entrypoint.sh"]\nCMD ["postgres"']],
    'ENTRYPOINT non previsto',
  ],
  [
    'un ENV PGBACKREST_…',
    [['COPY pgbackrest.conf', 'ENV PGBACKREST_REPO1_TYPE=s3\nCOPY pgbackrest.conf']],
    'ENV con PGBACKREST: PGBACKREST_REPO1_TYPE',
  ],
  [
    'pgbackrest.conf copiato in /etc/pgbackrest.conf',
    [['/etc/pgbackrest/pgbackrest.conf', '/etc/pgbackrest.conf']],
    'una COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf',
  ],
  [
    'pgbackrest.conf copiato con --chmod=600',
    [['COPY pgbackrest.conf', 'COPY --chmod=600 pgbackrest.conf']],
    'una COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf',
  ],
  [
    'gli script senza --chmod=755',
    [['COPY --chmod=755 pgbackrest-summary', 'COPY pgbackrest-summary']],
    'una sola COPY --chmod=755',
  ],
  [
    'gli script in due COPY',
    [
      [
        'COPY --chmod=755 pgbackrest-summary pgbackrest-init /usr/local/bin/',
        'COPY --chmod=755 pgbackrest-summary /usr/local/bin/\nCOPY --chmod=755 pgbackrest-init /usr/local/bin/',
      ],
    ],
    'una sola COPY --chmod=755',
  ],
  [
    'gli script in /usr/bin/',
    [['pgbackrest-init /usr/local/bin/', 'pgbackrest-init /usr/bin/']],
    'una sola COPY --chmod=755',
  ],
  ['il HEALTHCHECK cambiato (--retries=5)', [['--retries=12', '--retries=5']], 'atteso una volta HEALTHCHECK'],
  [
    'il CMD senza config_file',
    [['CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]', 'CMD ["postgres"]']],
    'atteso una volta CMD',
  ],
  ['la label con un altro repository', [['gestionale-negozi"', 'altro-repository"']], 'atteso una volta LABEL'],
  [
    'senza la COPY di roles.sql.tpl',
    [['COPY roles.sql.tpl /opt/roles.sql.tpl\n', '']],
    'atteso una volta COPY roles.sql.tpl',
  ],
];

// --- pgbackrest.conf -------------------------------------------------------------------------------------------------

/** Le opzioni uguali su tutti i server, per sezione (08, note del piano di OPS-T01a, «Configurazione»). */
const PGBACKREST_OPTIONS: [section: string, lines: string[]][] = [
  [
    'global',
    [
      'repo1-type=s3',
      'repo1-path=/pgbackrest',
      'repo1-cipher-type=aes-256-cbc',
      'repo1-retention-full-type=time',
      'repo1-retention-full=30',
      'start-fast=y',
      'log-level-file=off',
    ],
  ],
  ['main', ['pg1-path=/var/lib/postgresql/18/docker']],
];

/** Le opzioni che ogni server legge dalle sue variabili PGBACKREST_* (postgres.env): mai nel file dell'immagine. */
const SERVER_OPTIONS = [
  'repo1-s3-endpoint',
  'repo1-s3-bucket',
  'repo1-s3-region',
  'repo1-s3-key',
  'repo1-s3-key-secret',
  'repo1-cipher-pass',
];

interface IniFile {
  /** Righe prima della prima sezione. */
  outside: string[];
  /** Sezioni nell'ordine del file, ciascuna con le sue righe in ordine alfabetico (l'ordine delle chiavi è libero). */
  sections: { name: string; lines: string[] }[];
}

/**
 * pgbackrest.conf come lo legge il controllo: come pgBackRest, ogni riga senza gli spazi ai lati; righe vuote e
 * commenti (`#`) tolti, le altre divise per sezione e confrontate così come sono scritte (gli spazi attorno a `=`
 * restano, e sono un problema). Il valore di una chiave che può essere un segreto si nasconde, così un errore del test
 * non lo scrive.
 */
function parsePgbackrestConf(text: string): IniFile {
  const outside: string[] = [];
  const sections: { name: string; lines: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const line = trimmed.replace(/^([^=]*(pass|secret|key|token)[^=]*)=.*$/i, '$1=<valore nascosto>');
    const header = /^\[(.*)\]$/.exec(line);
    const current = sections.at(-1);
    if (header !== null) sections.push({ name: header[1] ?? '', lines: [] });
    else if (current !== undefined) current.lines.push(line);
    else outside.push(line);
  }
  return { outside, sections: sections.map(({ name, lines }) => ({ name, lines: [...lines].sort() })) };
}

/** Esattamente [global] e [main], in quest'ordine, con esattamente le righe `chiave=valore` della specifica. */
function pgbackrestConfProblems(text: string): string[] {
  const { outside, sections } = parsePgbackrestConf(text);
  const problems: string[] = [];
  if (outside.length > 0) problems.push(`righe prima della prima sezione: ${JSON.stringify(outside)}`);
  const names = sections.map(({ name }) => `[${name}]`).join(' ');
  if (names !== '[global] [main]')
    problems.push(`sezioni ${names || 'nessuna'}: attese [global] e [main], in quest’ordine`);
  for (const { name, lines } of sections) {
    const missing = [...(PGBACKREST_OPTIONS.find(([section]) => section === name)?.[1] ?? [])];
    const extra: string[] = [];
    for (const line of lines) {
      const index = missing.indexOf(line);
      if (index === -1) extra.push(line);
      else missing.splice(index, 1);
    }
    if (extra.length > 0) problems.push(`[${name}] righe non previste: ${JSON.stringify(extra)}`);
    if (missing.length > 0) problems.push(`[${name}] righe mancanti: ${JSON.stringify(missing)}`);
  }
  return problems;
}

const SAMPLE_PGBACKREST_GLOBAL = ['[global]', ...(PGBACKREST_OPTIONS[0]?.[1] ?? [])].join('\n');
const SAMPLE_PGBACKREST_CONF = [
  '# Opzioni uguali su tutti i server; il resto lo legge pgBackRest dalle variabili PGBACKREST_* di postgres.env.',
  SAMPLE_PGBACKREST_GLOBAL,
  '',
  '[main]',
  'pg1-path=/var/lib/postgresql/18/docker',
  '',
].join('\n');

const PGBACKREST_CONF_ACCEPTED: Accepted[] = [
  ['il file di prova così com’è', []],
  [
    'le chiavi in un altro ordine, con commenti e righe vuote in mezzo',
    [
      [
        SAMPLE_PGBACKREST_GLOBAL,
        [
          '[global]',
          '# Niente file di log: nel container non ruoterebbe mai.',
          'log-level-file=off',
          'start-fast=y',
          '',
          '# Conservazione: 30 giorni di ripristino puntuale.',
          'repo1-retention-full=30',
          'repo1-retention-full-type=time',
          'repo1-cipher-type=aes-256-cbc',
          'repo1-path=/pgbackrest',
          'repo1-type=s3',
        ].join('\n'),
      ],
    ],
  ],
  [
    'spazi in fondo a una riga e attorno all’intestazione di una sezione (pgBackRest toglie gli spazi ai lati di ogni riga)',
    [
      ['repo1-type=s3', 'repo1-type=s3  '],
      ['\n[main]', '\n  [main] '],
    ],
  ],
];

const PGBACKREST_CONF_REJECTED: Rejected[] = [
  [
    'una chiave in più in [global] (repo1-s3-uri-style=path)',
    [['start-fast=y', 'start-fast=y\nrepo1-s3-uri-style=path']],
    '[global] righe non previste: ["repo1-s3-uri-style=path"]',
  ],
  [
    'repo1-cipher-pass nel file',
    [['start-fast=y', 'start-fast=y\nrepo1-cipher-pass=VALORE-PROVA-SEGRETO-CIFRATURA']],
    '[global] righe non previste: ["repo1-cipher-pass=<valore nascosto>"]',
  ],
  [
    'il segreto S3 nel file',
    [['start-fast=y', 'start-fast=y\nrepo1-s3-key-secret=VALORE-PROVA-SEGRETO-S3']],
    '[global] righe non previste: ["repo1-s3-key-secret=<valore nascosto>"]',
  ],
  [
    'endpoint e bucket nel file',
    [['start-fast=y', 'start-fast=y\nrepo1-s3-endpoint=s3.example.invalid\nrepo1-s3-bucket=bucket-di-prova']],
    '[global] righe non previste: ["repo1-s3-bucket=bucket-di-prova","repo1-s3-endpoint=s3.example.invalid"]',
  ],
  [
    'pg1-path in [global] invece che in [main]',
    [['\n\n[main]\npg1-path=/var/lib/postgresql/18/docker', '\npg1-path=/var/lib/postgresql/18/docker\n\n[main]']],
    '[global] righe non previste: ["pg1-path=/var/lib/postgresql/18/docker"]',
  ],
  ['spazi attorno a =', [['repo1-type=s3', 'repo1-type = s3']], '[global] righe non previste: ["repo1-type = s3"]'],
  [
    'le sezioni in ordine inverso',
    [
      ['\n\n[main]\npg1-path=/var/lib/postgresql/18/docker', ''],
      [SAMPLE_PGBACKREST_GLOBAL, `[main]\npg1-path=/var/lib/postgresql/18/docker\n\n${SAMPLE_PGBACKREST_GLOBAL}`],
    ],
    'sezioni [main] [global]',
  ],
  [
    'una terza sezione ([global:archive-push])',
    [['\n\n[main]', '\n\n[global:archive-push]\ncompress-level=3\n\n[main]']],
    'sezioni [global] [global:archive-push] [main]',
  ],
  [
    'una chiave in meno (log-level-file=off)',
    [['\nlog-level-file=off', '']],
    '[global] righe mancanti: ["log-level-file=off"]',
  ],
  [
    'la conservazione di 14 giorni',
    [['repo1-retention-full=30', 'repo1-retention-full=14']],
    '[global] righe non previste: ["repo1-retention-full=14"]',
  ],
  [
    'la conservazione per numero di backup',
    [['repo1-retention-full-type=time', 'repo1-retention-full-type=count']],
    '[global] righe non previste: ["repo1-retention-full-type=count"]',
  ],
  [
    'la cifratura spenta',
    [['repo1-cipher-type=aes-256-cbc', 'repo1-cipher-type=none']],
    '[global] righe non previste: ["repo1-cipher-type=none"]',
  ],
  [
    'una chiave ripetuta',
    [['start-fast=y', 'start-fast=y\nstart-fast=y']],
    '[global] righe non previste: ["start-fast=y"]',
  ],
  [
    'una chiave prima della prima sezione',
    [
      ['[global]', 'start-fast=y\n[global]'],
      ['\nstart-fast=y\nlog', '\nlog'],
    ],
    'righe prima della prima sezione: ["start-fast=y"]',
  ],
  [
    'un commento in fondo a una riga (pgBackRest lo leggerebbe nel valore)',
    [['start-fast=y', 'start-fast=y # veloce']],
    '[global] righe non previste: ["start-fast=y # veloce"]',
  ],
];

// --- postgresql.conf e compose.dev.yml ---------------------------------------------------------------------------------

/** Archiviazione dei WAL con pgBackRest (08 §pgBackRest), nella forma esatta delle righe. */
const ARCHIVING_SETTINGS = [
  'archive_mode = on',
  "archive_command = 'pgbackrest --stanza=main archive-push %p'",
  'archive_timeout = 60',
  'wal_level = replica',
];
/** Le impostazioni di base di FON-T03, che restano. */
const BASE_SETTINGS = ["listen_addresses = '*'", "timezone = 'UTC'", "log_timezone = 'UTC'"];

/** Una riga di impostazione: `nome = valore`, con le stringhe fra apici singoli (`''` dentro una stringa). */
const SETTING_FORM = /^[a-z_][a-z0-9_.]* = ('(?:[^']|'')*'|[^\s'=#]+)$/;

/** Una riga di postgresql.conf senza il commento in fondo (un `#` fuori dagli apici) e senza spazi ai lati. */
function withoutComment(raw: string): string {
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charAt(i);
    if (c === "'") quoted = !quoted;
    else if (c === '#' && !quoted) return raw.slice(0, i).trim();
  }
  return raw.trim();
}

/** Ogni riga attesa c'è una volta sola (nessun'altra riga con lo stesso nome); ogni impostazione ha la forma giusta. */
function postgresqlConfProblems(text: string, expected: string[]): string[] {
  const settings = text
    .split(/\r?\n/)
    .map(withoutComment)
    .filter((line) => line !== '')
    .map((line) => ({ name: (/^[A-Za-z_][A-Za-z0-9_.]*/.exec(line)?.[0] ?? '').toLowerCase(), line }));
  const problems = settings
    .filter(({ line }) => !SETTING_FORM.test(line))
    .map(({ line }) => `forma «nome = valore», stringhe fra apici singoli: ${line}`);
  for (const want of expected) {
    const name = want.split(' ')[0] ?? '';
    const found = settings.filter((setting) => setting.name === name).map((setting) => setting.line);
    if (found.length !== 1 || found[0] !== want)
      problems.push(`atteso una volta ${want}, trovati ${JSON.stringify(found)}`);
  }
  return problems;
}

const SAMPLE_POSTGRESQL_CONF = [
  '# postgresql.conf di prova dei controlli.',
  "listen_addresses = '*'",
  '',
  "timezone = 'UTC'",
  "log_timezone = 'UTC'",
  '',
  '# Archiviazione dei WAL con pgBackRest.',
  'wal_level = replica',
  'archive_mode = on',
  "archive_command = 'pgbackrest --stanza=main archive-push %p'",
  'archive_timeout = 60',
  '',
].join('\n');

const POSTGRESQL_CONF_ACCEPTED: Accepted[] = [
  ['il file di prova così com’è', []],
  [
    'un commento in fondo a una riga e un’altra impostazione',
    [['archive_timeout = 60', 'archive_timeout = 60  # secondi\nmax_wal_size = 2GB']],
  ],
  [
    'le impostazioni in un altro ordine',
    [
      ['wal_level = replica\n', ''],
      ['archive_timeout = 60', 'archive_timeout = 60\nwal_level = replica'],
    ],
  ],
];

const POSTGRESQL_CONF_REJECTED: Rejected[] = [
  ['archive_mode = off', [['archive_mode = on', 'archive_mode = off']], 'atteso una volta archive_mode = on'],
  [
    'archive_timeout = 300',
    [['archive_timeout = 60', 'archive_timeout = 300']],
    'atteso una volta archive_timeout = 60',
  ],
  [
    'archive_command con %f al posto di %p',
    [['archive-push %p', 'archive-push %f']],
    'atteso una volta archive_command',
  ],
  ['archive_command con un’altra stanza', [['--stanza=main', '--stanza=prova']], 'atteso una volta archive_command'],
  ['wal_level = minimal', [['wal_level = replica', 'wal_level = minimal']], 'atteso una volta wal_level = replica'],
  ['senza wal_level', [['wal_level = replica\n', '']], 'atteso una volta wal_level = replica, trovati []'],
  ['senza spazi attorno a =', [['archive_timeout = 60', 'archive_timeout=60']], 'forma «nome = valore»'],
  [
    'archive_mode ripetuto, l’ultimo off',
    [['archive_timeout = 60', 'archive_timeout = 60\narchive_mode = off']],
    'atteso una volta archive_mode = on, trovati ["archive_mode = on","archive_mode = off"]',
  ],
  ['senza listen_addresses', [["listen_addresses = '*'\n", '']], "atteso una volta listen_addresses = '*'"],
  ['timezone senza apici', [["\ntimezone = 'UTC'", '\ntimezone = UTC']], "atteso una volta timezone = 'UTC'"],
];

/** Il comando di postgres in infra/compose.dev.yml, come elenco: archiviazione spenta in sviluppo (08 §pgBackRest). */
const DEV_POSTGRES_COMMAND = [
  'postgres',
  '-c',
  'config_file=/etc/postgresql/postgresql.conf',
  '-c',
  'archive_mode=off',
];

// --- versions.env ----------------------------------------------------------------------------------------------------

/** Una riga POSTGRES_TAG=<versione del FROM>-<revisione: intero positivo senza zeri iniziali> (08, OPS-T01a, «Tag»). */
function postgresTagProblems(text: string, version: string): string[] {
  const tags = text
    .split(/\r?\n/)
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('POSTGRES_TAG'));
  if (tags.length !== 1) return [`una riga POSTGRES_TAG, trovate ${tags.length}`];
  const match = /^POSTGRES_TAG=(\d+\.\d+)-[1-9]\d*$/.exec(tags[0] ?? '');
  if (match === null) return [`forma POSTGRES_TAG=<versione>-<revisione>: ${tags[0]}`];
  if (match[1] !== version) return [`POSTGRES_TAG ha la versione ${match[1]}, il FROM del Dockerfile ${version}`];
  return [];
}

const VERSIONS_REJECTED: [line: string, problem: string][] = [
  ['POSTGRES_TAG=18.7', 'forma POSTGRES_TAG='],
  ['POSTGRES_TAG=18.7-01', 'forma POSTGRES_TAG='],
  ['POSTGRES_TAG=18.7-0', 'forma POSTGRES_TAG='],
  ['POSTGRES_TAG=18.6-1', 'POSTGRES_TAG ha la versione 18.6'],
  ['POSTGRES_TAG=18.7-trixie-1', 'forma POSTGRES_TAG='],
  ['POSTGRES_TAG="18.7-1"', 'forma POSTGRES_TAG='],
  ['POSTGRES_TAG=18.7-1\nPOSTGRES_TAG=18.7-2', 'una riga POSTGRES_TAG, trovate 2'],
  ['', 'una riga POSTGRES_TAG, trovate 0'],
];

// --- compose.yml -----------------------------------------------------------------------------------------------------

const ANCHOR_LINE = 'x-postgres-image: &postgres-image';
const MERGE_LINE = '<<: *postgres-image';
const POSTGRES_IMAGE = /^image:\s+(['"]?)ghcr\.io\/jinoesfoo\/gestionale-negozi-postgres:\$\{POSTGRES_TAG:\?[^}]*\}\1$/;

/** Le righe di un file YAML senza commenti né righe vuote, con il rientro e senza spazi in fondo. */
function yamlLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Le righe che seguono la riga `index` con un rientro maggiore del suo: il suo blocco. */
function blockAfter(lines: string[], index: number): string[] {
  const indent = indentOf(lines[index] ?? '');
  const end = lines.findIndex((line, i) => i > index && indentOf(line) <= indent);
  return lines.slice(index + 1, end === -1 ? undefined : end);
}

/** Il blocco della chiave `<rientro><chiave>:`, o null se la chiave non c'è. */
function yamlBlock(lines: string[], key: string, indent: number): string[] | null {
  const index = lines.indexOf(`${' '.repeat(indent)}${key}:`);
  return index === -1 ? null : blockAfter(lines, index);
}

/** Le chiavi del primo livello di un blocco (le righe con il rientro più piccolo), senza spazi ai lati. */
function topLevel(block: string[]): string[] {
  const indent = Math.min(...block.map(indentOf));
  return block.filter((line) => indentOf(line) === indent).map((line) => line.trim());
}

function initServiceProblems(text: string): string[] {
  const services = yamlBlock(yamlLines(text), 'services', 0) ?? [];
  const count = services.filter((line) => line === '  pgbackrest-init:').length;
  return count === 1 ? [] : [`una riga «  pgbackrest-init:» fra i servizi, trovate ${count}`];
}

/** postgres e pgbackrest-init prendono l'immagine dal frammento x-postgres-image, unica riga dell'immagine postgres. */
function sharedImageProblems(text: string): string[] {
  const lines = yamlLines(text);
  const problems: string[] = [];
  const anchor = lines.indexOf(ANCHOR_LINE);
  if (anchor === -1 || lines.lastIndexOf(ANCHOR_LINE) !== anchor) {
    problems.push(`una riga «${ANCHOR_LINE}» al primo livello`);
  } else {
    const block = blockAfter(lines, anchor).map((line) => line.trim());
    if (block.length !== 1 || !POSTGRES_IMAGE.test(block[0] ?? '')) {
      problems.push(
        `il blocco di x-postgres-image ha solo la riga image: dell’immagine postgres: ${JSON.stringify(block)}`,
      );
    }
  }
  const imageLines = lines.filter((line) => line.includes('gestionale-negozi-postgres'));
  if (imageLines.length !== 1)
    problems.push(`l’immagine postgres compare in ${imageLines.length} righe, attesa in una`);
  const merges = lines.flatMap((line, index) => (line.trim() === MERGE_LINE ? [index] : []));
  if (merges.length !== 2) problems.push(`due righe «${MERGE_LINE}», trovate ${merges.length}`);
  if (anchor !== -1 && merges.some((index) => index < anchor)) {
    problems.push('il frammento x-postgres-image va scritto prima dei servizi che lo usano');
  }
  const services = yamlBlock(lines, 'services', 0) ?? [];
  for (const name of ['postgres', 'pgbackrest-init']) {
    const keys = topLevel(yamlBlock(services, name, 2) ?? []);
    if (keys.filter((key) => key === MERGE_LINE).length !== 1) {
      problems.push(`${name}: una riga «${MERGE_LINE}» fra le sue chiavi`);
    }
    if (keys.some((key) => key.startsWith('image:'))) {
      problems.push(`${name}: una riga image: sua sostituirebbe quella del frammento`);
    }
  }
  return problems;
}

function composeProblems(text: string): string[] {
  return [...initServiceProblems(text), ...sharedImageProblems(text)];
}

const SAMPLE_COMPOSE_IMAGE =
  'ghcr.io/jinoesfoo/gestionale-negozi-postgres:${POSTGRES_TAG:?manca POSTGRES_TAG in /srv/app/.env}';
const SAMPLE_COMPOSE_ANCHOR = [ANCHOR_LINE, `  image: ${SAMPLE_COMPOSE_IMAGE}`].join('\n');

const SAMPLE_COMPOSE = [
  'x-logging: &logging',
  '  driver: json-file',
  '',
  SAMPLE_COMPOSE_ANCHOR,
  '',
  'services:',
  '  app:',
  '    image: ghcr.io/jinoesfoo/gestionale-negozi-app:${APP_TAG:?manca APP_TAG in /srv/app/.env}',
  '    logging: *logging',
  '',
  '  postgres:',
  '    <<: *postgres-image',
  '    restart: unless-stopped',
  '',
  '  pgbackrest-init:',
  '    <<: *postgres-image',
  '    command: [pgbackrest-init]',
  "    restart: 'no'",
  '',
  'volumes:',
  '  pgdata:',
  '',
].join('\n');

const COMPOSE_ACCEPTED: Accepted[] = [
  ['il file di prova così com’è', []],
  [
    'un commento nel frammento e <<: dopo le altre chiavi del servizio',
    [
      [`${ANCHOR_LINE}\n`, `${ANCHOR_LINE}\n  # La stessa immagine per postgres e pgbackrest-init.\n`],
      ['    <<: *postgres-image\n    restart: unless-stopped', '    restart: unless-stopped\n    <<: *postgres-image'],
    ],
  ],
  ['l’immagine del frammento fra apici', [[`  image: ${SAMPLE_COMPOSE_IMAGE}`, `  image: '${SAMPLE_COMPOSE_IMAGE}'`]]],
];

const COMPOSE_REJECTED: Rejected[] = [
  [
    'postgres con una riga image: sua',
    [['    <<: *postgres-image\n    restart', '    <<: *postgres-image\n    image: postgres:18.7-trixie\n    restart']],
    'postgres: una riga image: sua',
  ],
  [
    'pgbackrest-init con la riga image: al posto di <<:',
    [['    <<: *postgres-image\n    command', `    image: ${SAMPLE_COMPOSE_IMAGE}\n    command`]],
    'pgbackrest-init: una riga «<<: *postgres-image» fra le sue chiavi',
  ],
  [
    'il frammento dopo i servizi',
    [
      [`${SAMPLE_COMPOSE_ANCHOR}\n\n`, ''],
      ['volumes:', `${SAMPLE_COMPOSE_ANCHOR}\n\nvolumes:`],
    ],
    'il frammento x-postgres-image va scritto prima dei servizi',
  ],
  [
    'il frammento con una chiave in più',
    [[SAMPLE_COMPOSE_ANCHOR, `${SAMPLE_COMPOSE_ANCHOR}\n  restart: unless-stopped`]],
    'il blocco di x-postgres-image ha solo la riga image:',
  ],
  [
    'il frammento con un’altra immagine',
    [[SAMPLE_COMPOSE_IMAGE, 'postgres:18']],
    'il blocco di x-postgres-image ha solo la riga image:',
  ],
  [
    'il frammento con un’altra ancora',
    [[ANCHOR_LINE, 'x-postgres-image: &pg']],
    'una riga «x-postgres-image: &postgres-image» al primo livello',
  ],
  [
    'senza il servizio pgbackrest-init',
    [["\n  pgbackrest-init:\n    <<: *postgres-image\n    command: [pgbackrest-init]\n    restart: 'no'\n", '']],
    'una riga «  pgbackrest-init:» fra i servizi, trovate 0',
  ],
  [
    'una terza riga <<: *postgres-image',
    [['    logging: *logging', '    logging: *logging\n    <<: *postgres-image']],
    'due righe «<<: *postgres-image», trovate 3',
  ],
];

// --- Test ------------------------------------------------------------------------------------------------------------

describe('Dockerfile dell’immagine PostgreSQL (infra/postgres/Dockerfile)', () => {
  const instructions = () => dockerInstructions(read(DOCKERFILE));

  it('OPS-001: una sola fase, FROM postgres:18.7-trixie', () => {
    expect(fromProblems(instructions())).toEqual([]);
  });

  it('OPS-001: una RUN installa con apt-get esattamente pgbackrest, jq e ca-certificates, con --no-install-recommends (e -y facoltativo), senza versioni fissate, dopo apt-get update e prima della pulizia di /var/lib/apt/lists/*', () => {
    expect(packageProblems(instructions())).toEqual([]);
  });

  it('OPS-001: una RUN toglie il file d’esempio del pacchetto con rm -f /etc/pgbackrest.conf, dopo l’installazione', () => {
    expect(sampleFileProblems(instructions())).toEqual([]);
  });

  it('OPS-001: COPY pgbackrest.conf in /etc/pgbackrest/pgbackrest.conf e una sola COPY --chmod=755 di pgbackrest-summary e pgbackrest-init in /usr/local/bin/', () => {
    expect(copyProblems(instructions())).toEqual([]);
  });

  it('OPS-001: nessun ENTRYPOINT (resta quello dell’immagine di base) e nessun ENV con PGBACKREST', () => {
    expect(entrypointAndEnvProblems(instructions())).toEqual([]);
  });

  it('OPS-001: la label del repository, le COPY di postgresql.conf e roles.sql.tpl, il HEALTHCHECK e il CMD restano come prima di OPS-T01a', () => {
    expect(unchangedProblems(instructions())).toEqual([]);
  });

  it.each(DOCKERFILE_ACCEPTED)('OPS-001: il controllo del Dockerfile accetta %s', (_label, changes) => {
    expect(dockerfileProblems(applyChanges(SAMPLE_DOCKERFILE, changes))).toEqual([]);
  });

  it.each(DOCKERFILE_REJECTED)('OPS-001: il controllo del Dockerfile rifiuta %s', (_label, changes, problem) => {
    expectProblem(dockerfileProblems(applyChanges(SAMPLE_DOCKERFILE, changes)), problem);
  });
});

describe('script dell’immagine (infra/postgres/pgbackrest-summary e pgbackrest-init)', () => {
  it.each(IMAGE_SCRIPTS)('OPS-001: %s è eseguibile e comincia con #!/usr/bin/env bash o #!/bin/bash', (path) => {
    expect(existsSync(repoPath(path)), `manca il file ${path}`).toBe(true);
    expect(statSync(repoPath(path)).mode & 0o111, 'almeno un bit di esecuzione').not.toBe(0);
    const firstLine = readFileSync(repoPath(path), 'utf8').split('\n')[0];
    expect(['#!/usr/bin/env bash', '#!/bin/bash']).toContain(firstLine);
  });
});

describe('configurazione di pgBackRest (infra/postgres/pgbackrest.conf)', () => {
  it('OPS-001: solo [global] e [main], in quest’ordine, con esattamente le opzioni uguali su tutti i server (archivio S3 in /pgbackrest, cifrato aes-256-cbc, start-fast, nessun file di log; pg1-path della stanza)', () => {
    expect(pgbackrestConfProblems(read(PGBACKREST_CONF))).toEqual([]);
  });

  it('OPS-002: conservazione a tempo di 30 giorni: repo1-retention-full-type=time e repo1-retention-full=30 in [global], e nessun’altra regola di conservazione', () => {
    const conf = parsePgbackrestConf(read(PGBACKREST_CONF));
    const retention = (lines: string[]) => lines.filter((line) => /^repo\d*-retention/.test(line));
    expect(retention(conf.outside)).toEqual([]);
    expect(
      conf.sections
        .map(({ name, lines }) => ({ name, lines: retention(lines) }))
        .filter(({ lines }) => lines.length > 0),
    ).toEqual([{ name: 'global', lines: ['repo1-retention-full-type=time', 'repo1-retention-full=30'].sort() }]);
  });

  it('OPS-001, 00§4.2: nessun segreto né valore di un server: endpoint, bucket, regione, chiavi e repo1-cipher-pass vengono dalle variabili PGBACKREST_* di postgres.env', () => {
    const conf = parsePgbackrestConf(read(PGBACKREST_CONF));
    const keys = [...conf.outside, ...conf.sections.flatMap(({ lines }) => lines)].map((line) =>
      (line.split('=')[0] ?? '').trim().toLowerCase(),
    );
    expect(keys.filter((key) => SERVER_OPTIONS.includes(key))).toEqual([]);
  });

  it.each(PGBACKREST_CONF_ACCEPTED)('OPS-001: il controllo di pgbackrest.conf accetta %s', (_label, changes) => {
    expect(pgbackrestConfProblems(applyChanges(SAMPLE_PGBACKREST_CONF, changes))).toEqual([]);
  });

  it.each(PGBACKREST_CONF_REJECTED)(
    'OPS-001: il controllo di pgbackrest.conf rifiuta %s',
    (_label, changes, problem) => {
      expectProblem(pgbackrestConfProblems(applyChanges(SAMPLE_PGBACKREST_CONF, changes)), problem);
    },
  );

  it('OPS-001, 00§4.2: il controllo di pgbackrest.conf non ripete il valore di una chiave segreta', () => {
    const text = applyChanges(SAMPLE_PGBACKREST_CONF, [
      [
        'start-fast=y',
        'start-fast=y\nrepo1-cipher-pass=VALORE-PROVA-SEGRETO-CIFRATURA\nrepo1-s3-key=VALORE-PROVA-CHIAVE',
      ],
    ]);
    expect(JSON.stringify([parsePgbackrestConf(text), pgbackrestConfProblems(text)])).not.toContain('VALORE-PROVA');
  });
});

describe('configurazione di PostgreSQL (infra/postgres/postgresql.conf e infra/compose.dev.yml)', () => {
  it("OPS-001: archiviazione continua dei WAL con pgBackRest: archive_mode = on, archive_command = 'pgbackrest --stanza=main archive-push %p', archive_timeout = 60, wal_level = replica", () => {
    expect(postgresqlConfProblems(read(POSTGRESQL_CONF), ARCHIVING_SETTINGS)).toEqual([]);
  });

  it("OPS-001: restano listen_addresses = '*', timezone = 'UTC' e log_timezone = 'UTC', e ogni impostazione è nella forma nome = valore", () => {
    expect(postgresqlConfProblems(read(POSTGRESQL_CONF), BASE_SETTINGS)).toEqual([]);
  });

  it('OPS-001: in sviluppo l’archiviazione resta spenta: compose.dev.yml avvia postgres con -c archive_mode=off e non ha variabili PGBACKREST', () => {
    const text = read(COMPOSE_DEV);
    const postgres = yamlBlock(yamlBlock(yamlLines(text), 'services', 0) ?? [], 'postgres', 2) ?? [];
    const commands = topLevel(postgres).filter((line) => line.startsWith('command:'));
    expect(commands).toHaveLength(1);
    const items = [...(commands[0] ?? '').matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? '');
    expect(items).toEqual(DEV_POSTGRES_COMMAND);
    expect(text).not.toContain('PGBACKREST');
  });

  it.each(POSTGRESQL_CONF_ACCEPTED)('OPS-001: il controllo di postgresql.conf accetta %s', (_label, changes) => {
    const text = applyChanges(SAMPLE_POSTGRESQL_CONF, changes);
    expect(postgresqlConfProblems(text, [...BASE_SETTINGS, ...ARCHIVING_SETTINGS])).toEqual([]);
  });

  it.each(POSTGRESQL_CONF_REJECTED)(
    'OPS-001: il controllo di postgresql.conf rifiuta %s',
    (_label, changes, problem) => {
      const text = applyChanges(SAMPLE_POSTGRESQL_CONF, changes);
      expectProblem(postgresqlConfProblems(text, [...BASE_SETTINGS, ...ARCHIVING_SETTINGS]), problem);
    },
  );
});

describe('tag dell’immagine (infra/versions.env)', () => {
  it('OPS-001: una riga POSTGRES_TAG=<versione di PostgreSQL del FROM>-<revisione> (18.7-1 alla prima pubblicazione)', () => {
    const version = postgresVersion(read(DOCKERFILE));
    expect(version, 'FROM postgres:<versione>-<variante> nel Dockerfile').toMatch(/^\d+\.\d+$/);
    expect(postgresTagProblems(read(VERSIONS), version)).toEqual([]);
  });

  it('OPS-001: il controllo di POSTGRES_TAG legge la versione dal FROM (postgres:18.7-trixie → 18.7)', () => {
    expect(postgresVersion(SAMPLE_DOCKERFILE)).toBe('18.7');
  });

  it.each(['POSTGRES_TAG=18.7-1', 'POSTGRES_TAG=18.7-2', 'POSTGRES_TAG=18.7-10'])(
    'OPS-001: il controllo di POSTGRES_TAG accetta %s',
    (line) => {
      expect(postgresTagProblems(`# commento\nCADDY_TAG=2.11.9-2\n${line}\n`, '18.7')).toEqual([]);
    },
  );

  it.each(VERSIONS_REJECTED)('OPS-001: il controllo di POSTGRES_TAG rifiuta %j', (line, problem) => {
    expectProblem(postgresTagProblems(`# commento\nCADDY_TAG=2.11.9-2\n${line}\n`, '18.7'), problem);
  });
});

describe('immagine di postgres e pgbackrest-init in infra/compose.yml', () => {
  it('OPS-001: c’è il servizio pgbackrest-init («  pgbackrest-init:» fra i servizi)', () => {
    expect(initServiceProblems(read(COMPOSE))).toEqual([]);
  });

  it('OPS-001: postgres e pgbackrest-init prendono l’immagine dal frammento x-postgres-image (<<: *postgres-image, due righe), che ha l’unica riga dell’immagine postgres', () => {
    expect(sharedImageProblems(read(COMPOSE))).toEqual([]);
  });

  it.each(COMPOSE_ACCEPTED)('OPS-001: il controllo di compose.yml accetta %s', (_label, changes) => {
    expect(composeProblems(applyChanges(SAMPLE_COMPOSE, changes))).toEqual([]);
  });

  it.each(COMPOSE_REJECTED)('OPS-001: il controllo di compose.yml rifiuta %s', (_label, changes, problem) => {
    expectProblem(composeProblems(applyChanges(SAMPLE_COMPOSE, changes)), problem);
  });
});
