import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// pgbackrest-summary (08 §Progetto «pgBackRest» e OPS-T01a, note del piano, «Script nell'immagine»): nel repository
// infra/postgres/pgbackrest-summary, nell'immagine /usr/local/bin/pgbackrest-summary, senza argomenti. Controlla le sei
// variabili PGBACKREST_* di postgres.env (01 §Variabili d'ambiente: presenti e non vuote, senza CAMBIA, l'endpoint
// senza ://) nominandole, mai con i valori (00 §4.2); poi riassume l'ultima riga di `pgbackrest --stanza=main info
// --output=json` in una riga `stanza <codice>` (per il 99 anche il tipo d'errore tra parentesi quadre, mai il resto del
// messaggio, che può contenere host e bucket) e una riga `backup <etichetta> <tipo> <byte nel repository>` per ogni
// backup, dal più vecchio. Lo usano pgbackrest-init (01 §Servizi, OPS-001) e infra/scripts/backup.sh (OPS-002,
// OPS-003). I testi esatti delle righe li fissa questo test. Qui gira lo script vero, nella cartella / come nel
// container, con un pgbackrest finto primo nel PATH (registra gli argomenti, stampa una risposta di esempio nella forma
// della 2.60 ed esce con il codice scelto) e il jq del computer, preso dal PATH (/usr/bin). Mai un pgbackrest vero,
// mai la rete.

const SUMMARY = fileURLToPath(new URL('../../../infra/postgres/pgbackrest-summary', import.meta.url));

/** Le sei variabili, nell'ordine in cui lo script le controlla. */
const VARIABLES = [
  'PGBACKREST_REPO1_S3_ENDPOINT',
  'PGBACKREST_REPO1_S3_BUCKET',
  'PGBACKREST_REPO1_S3_REGION',
  'PGBACKREST_REPO1_S3_KEY',
  'PGBACKREST_REPO1_S3_KEY_SECRET',
  'PGBACKREST_REPO1_CIPHER_PASS',
] as const;
type Variable = (typeof VARIABLES)[number];

/** Valori validi e riconoscibili; l'endpoint è solo l'host, come in infra/env.example/postgres.env. */
const VALID: Record<Variable, string> = {
  PGBACKREST_REPO1_S3_ENDPOINT: 'VALORE-PROVA-SEGRETO-ENDPOINT.example',
  PGBACKREST_REPO1_S3_BUCKET: 'VALORE-PROVA-SEGRETO-BUCKET',
  PGBACKREST_REPO1_S3_REGION: 'VALORE-PROVA-SEGRETO-REGIONE',
  PGBACKREST_REPO1_S3_KEY: 'VALORE-PROVA-SEGRETO-CHIAVE',
  PGBACKREST_REPO1_S3_KEY_SECRET: 'VALORE-PROVA-SEGRETO-SEGRETO',
  PGBACKREST_REPO1_CIPHER_PASS: 'VALORE-PROVA-SEGRETO-CIFRATURA',
};

/** I valori di infra/env.example/postgres.env, da sostituire: tutti con CAMBIA. */
const EXAMPLE: Record<Variable, string> = {
  PGBACKREST_REPO1_S3_ENDPOINT: 's3.CAMBIA.example',
  PGBACKREST_REPO1_S3_BUCKET: 'CAMBIA',
  PGBACKREST_REPO1_S3_REGION: 'CAMBIA',
  PGBACKREST_REPO1_S3_KEY: 'CAMBIA',
  PGBACKREST_REPO1_S3_KEY_SECRET: 'CAMBIA',
  PGBACKREST_REPO1_CIPHER_PASS: 'CAMBIA',
};

const missing = (name: Variable): string => `pgbackrest-summary: ${name}: manca o è vuota`;
const withCambia = (name: Variable): string => `pgbackrest-summary: ${name}: contiene CAMBIA`;
const ENDPOINT_WITH_SCHEME = 'pgbackrest-summary: PGBACKREST_REPO1_S3_ENDPOINT: contiene ://';
/** Una riga di problema, di qualunque variabile. */
const PROBLEM_LINE = /^pgbackrest-summary: PGBACKREST_[A-Z0-9_]+: (manca o è vuota|contiene CAMBIA|contiene :\/\/)$/;
const UNRECOGNISED = 'pgbackrest-summary: risposta di pgbackrest info non riconosciuta';
const exitedWith = (code: number): string => `pgbackrest-summary: pgbackrest info terminato con codice ${code}`;

// --- Risposte di esempio di `pgbackrest info --output=json` (2.60) ---------------------------------------------------

interface BackupFixture {
  label: string;
  type: 'full' | 'diff';
  /** Byte scritti nel repository da questo backup: il numero che il riassunto riporta. */
  repositoryDelta: number;
  /** Inizio del backup, in secondi dal 1970. */
  start: number;
  /** L'id del database della stanza (2 dopo uno stanza-upgrade). */
  db?: number;
}

/** Un backup come lo descrive `pgbackrest info --output=json` della 2.60. */
function backup({ label, type, repositoryDelta, start, db = 1 }: BackupFixture): Record<string, unknown> {
  const prior = type === 'diff' ? label.slice(0, label.indexOf('_')) : null;
  const size = 31_000_000;
  return {
    archive: { start: '000000010000000000000004', stop: '000000010000000000000004' },
    backrest: { format: 5, version: '2.60.1' },
    database: { id: db, 'repo-key': 1 },
    error: false,
    // Gli altri numeri sono diversi da repository.delta: info.size e info.delta contano i file dei dati, e
    // repository.size di un differenziale conta anche i file del completo a cui rimanda.
    info: {
      delta: type === 'full' ? size : 1_200_000,
      repository: { delta: repositoryDelta, size: type === 'full' ? repositoryDelta : repositoryDelta + 4_000_000 },
      size,
    },
    label,
    lsn: { start: '0/4000028', stop: '0/4000100' },
    prior,
    reference: prior === null ? null : [prior],
    timestamp: { start, stop: start + 9 },
    type,
  };
}

interface StanzaFixture {
  code: number;
  message: string;
  /** Il messaggio dello stato del repository (per il 99 il testo dell'errore), se diverso da quello della stanza. */
  repoMessage?: string;
  backups?: Record<string, unknown>[];
  /** Gli id dei database della stanza: più di uno dopo uno stanza-upgrade, nessuno se la stanza non si legge. */
  dbs?: number[];
}

/** Una stanza come la descrive `pgbackrest info --output=json` della 2.60. */
function stanza({ code, message, repoMessage = message, backups = [], dbs = [1] }: StanzaFixture) {
  const version = (id: number): string => (id === 1 ? '18' : '19');
  return {
    archive: dbs.map((id) => ({
      database: { id, 'repo-key': 1 },
      id: `${version(id)}-${id}`,
      max: '000000010000000000000006',
      min: '000000010000000000000001',
    })),
    backup: backups,
    cipher: 'aes-256-cbc',
    db: dbs.map((id) => ({ id, 'repo-key': 1, 'system-id': 7_440_541_040_329_322 + id, version: version(id) })),
    name: 'main',
    repo: [{ cipher: 'aes-256-cbc', key: 1, status: { code, message: repoMessage } }],
    status: { code, lock: { backup: { held: false }, restore: { held: false } }, message },
  };
}

/** La risposta di `pgbackrest --stanza=main info --output=json`: una sola riga, un array con la stanza. */
const info = (...stanzas: Record<string, unknown>[]): string => JSON.stringify(stanzas);

/** Una copia di `object` con il campo al percorso `path` cambiato in `value`, o tolto se `value` è undefined. */
function changed(object: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const copy = structuredClone(object);
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const last = path.at(-1) ?? '';
  if (value === undefined) delete target[last];
  else target[last] = value;
  return copy;
}

/** La stanza che manca, come la stampa la 2.60 prima di stanza-create. */
const STANZA_MISSING =
  '[{"archive":[],"backup":[],"cipher":"none","db":[],"name":"main","repo":[{"cipher":"none","key":1,"status":{"code":1,"message":"missing stanza path"}}],"status":{"code":1,"lock":{"backup":{"held":false},"restore":{"held":false}},"message":"missing stanza path"}}]';

const FULL: BackupFixture = {
  label: '20261129-033001F',
  type: 'full',
  repositoryDelta: 4_123_456,
  start: 1_795_919_401,
};
const DIFF: BackupFixture = {
  label: '20261129-033001F_20261130-033002D',
  type: 'diff',
  repositoryDelta: 2345,
  start: 1_796_005_802,
};
const FULL_AND_DIFF = info(stanza({ code: 0, message: 'ok', backups: [backup(FULL), backup(DIFF)] }));
const FULL_AND_DIFF_LINES =
  'stanza 0\nbackup 20261129-033001F full 4123456\nbackup 20261129-033001F_20261130-033002D diff 2345\n';

/** L'avviso che pgBackRest stampa sull'uscita standard, prima del JSON, per una variabile PGBACKREST_* sconosciuta. */
const WARNING = "P00   WARN: environment contains invalid option 'repo1-prova'";

/** L'errore 99 del repository con il 403 del bucket: dopo il tipo, percorso, intestazioni e host. */
const PROTOCOL_ERROR =
  '[ProtocolError] HTTP request failed with 403 (Forbidden):\n*** Path/Query ***:\nGET /?list-type=2&prefix=pgbackrest%2Farchive%2Fmain%2F\n*** Request Headers ***:\nauthorization: <redacted>\nhost: VALORE-PROVA-HOST-BUCKET.fsn1.example';

// --- Il pgbackrest finto e l'esecuzione dello script -----------------------------------------------------------------

/** Una stringa tra apici singoli per sh. */
const shellQuote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * Il pgbackrest finto: a ogni chiamata aggiunge a `chiamate` gli argomenti, ognuno chiuso da \037, e un \036 in fondo;
 * poi stampa il file `risposta` sull'uscita standard e, dopo, il file `risposta-errore` sull'errore standard, ed esce
 * con il codice scritto nel file `codice`.
 */
function fakePgbackrest(dir: string): string {
  return `#!/bin/sh
dir=${shellQuote(dir)}
{ for arg in "$@"; do printf '%s\\037' "$arg"; done; printf '\\036'; } >> "$dir/chiamate"
cat "$dir/risposta"
cat "$dir/risposta-errore" >&2
exit "$(cat "$dir/codice")"
`;
}

let root: string;
let binDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ops-t01a-summary-'));
  binDir = join(root, 'bin');
  mkdirSync(binDir);
  writeFileSync(join(binDir, 'pgbackrest'), fakePgbackrest(root));
  chmodSync(join(binDir, 'pgbackrest'), 0o755);
  pgbackrestAnswers(`${STANZA_MISSING}\n`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Quello che il pgbackrest finto stampa sull'uscita standard e sull'errore standard, e il suo codice di uscita. */
function pgbackrestAnswers(stdout: string, code = 0, stderr = ''): void {
  writeFileSync(join(root, 'risposta'), stdout);
  writeFileSync(join(root, 'risposta-errore'), stderr);
  writeFileSync(join(root, 'codice'), `${code}\n`);
}

/** Le chiamate registrate da un programma finto: una per \036, con gli argomenti chiusi da \037. */
function readCalls(file: string): string[][] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\x1e')
    .slice(0, -1)
    .map((call) => call.split('\x1f').slice(0, -1));
}

/** Le righe di un testo, senza l'a capo finale. */
const linesOf = (text: string): string[] => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Gli argomenti di ogni chiamata al pgbackrest finto. */
  calls: string[][];
}

/**
 * Lo script con solo PATH, TMPDIR e le variabili date, nella cartella / come nel container (l'immagine non ha
 * WORKDIR): uno script che scrivesse nella cartella corrente lì fallirebbe, e qui pure.
 */
function runSummary(variables: Record<string, string> = VALID): Run {
  const childEnv: Record<string, string> = { PATH: `${binDir}:/usr/bin:/bin`, TMPDIR: tmpdir(), ...variables };
  const result = spawnSync(SUMMARY, [], {
    cwd: '/',
    // I tipi di Next.js vogliono NODE_ENV in ProcessEnv: qui l'ambiente ha solo le variabili date.
    env: childEnv as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: readCalls(join(root, 'chiamate')),
  };
}

/** Le variabili valide con le modifiche del caso: `undefined` toglie la variabile dall'ambiente. */
function variablesWith(changes: Partial<Record<Variable, string | undefined>>): Record<string, string> {
  const merged: Record<string, string | undefined> = { ...VALID, ...changes };
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(merged)) if (value !== undefined) variables[name] = value;
  return variables;
}

// --- Controlli comuni ------------------------------------------------------------------------------------------------

/** Nessun valore delle variabili e nessun testo di prova (host, bucket, chiavi: VALORE-PROVA-…) nell'uscita. */
function expectNoValues(run: Run, values: string[] = Object.values(VALID)): void {
  for (const [stream, text] of [
    ['stdout', run.stdout],
    ['stderr', run.stderr],
  ] as const) {
    expect(text, stream).not.toContain('VALORE-PROVA');
    for (const value of values.filter((v) => v !== '')) expect(text, stream).not.toContain(value);
  }
}

/**
 * Il controllo delle variabili non è passato: uscita 2, niente sull'uscita standard, pgbackrest mai eseguito, e
 * sull'errore standard esattamente le righe dei problemi, nell'ordine, più al massimo una riga finale dello script, che
 * comincia con `pgbackrest-summary: ` e non è una riga di problema.
 */
function expectProblems(run: Run, problems: string[]): void {
  expect(run.status).toBe(2);
  expect(run.stdout).toBe('');
  expect(run.calls, 'pgbackrest non eseguito').toEqual([]);
  const lines = linesOf(run.stderr);
  expect(lines.slice(0, problems.length)).toEqual(problems);
  const extra = lines.slice(problems.length);
  expect(extra.length, `righe in più: ${JSON.stringify(extra)}`).toBeLessThanOrEqual(1);
  for (const line of extra) {
    expect(line).toMatch(/^pgbackrest-summary: /);
    expect(line).not.toMatch(PROBLEM_LINE);
  }
}

/** Il riassunto è riuscito: uscita 0, esattamente le righe attese, pgbackrest eseguito una volta. */
function expectSummary(run: Run, lines: string): void {
  expect(run.status).toBe(0);
  expect(run.stdout).toBe(lines);
  expect(run.calls).toHaveLength(1);
}

/** Il riassunto non è riuscito: uscita 1, niente sull'uscita standard, la riga dello script sull'errore standard. */
function expectFailure(run: Run, line: string): void {
  expect(run.status).toBe(1);
  expect(run.stdout).toBe('');
  expect(linesOf(run.stderr)).toContain(line);
  expect(run.calls).toHaveLength(1);
}

/** L'uscita standard di pgbackrest non passa mai nell'uscita dello script, su nessuno dei due canali. */
function expectNotCopied(run: Run, pgbackrestStdout: string): void {
  for (const line of linesOf(pgbackrestStdout).filter((l) => l.trim() !== '')) {
    expect(run.stdout).not.toContain(line);
    expect(run.stderr).not.toContain(line);
  }
}

// --- Test ------------------------------------------------------------------------------------------------------------

describe('pgbackrest-summary (infra/postgres/pgbackrest-summary)', () => {
  it('OPS-001: è uno script bash eseguibile', () => {
    expect(statSync(SUMMARY).mode & 0o111).not.toBe(0);
    expect(['#!/usr/bin/env bash', '#!/bin/bash']).toContain(readFileSync(SUMMARY, 'utf8').split('\n')[0]);
  });
});

describe('pgbackrest-summary: le sei variabili PGBACKREST_*, mai con i valori', () => {
  it('OPS-001, 00§4.2: con le sei variabili valide esegue una volta pgbackrest con --stanza=main, --output=json e info, senza i valori negli argomenti, e non li stampa', () => {
    const run = runSummary();
    expectSummary(run, 'stanza 1\n');
    const args = run.calls[0] ?? [];
    expect(args).toEqual(expect.arrayContaining(['--stanza=main', '--output=json', 'info']));
    for (const value of Object.values(VALID)) expect(args.join(' ')).not.toContain(value);
    expectNoValues(run);
  });

  it('OPS-001, 00§4.2: senza nessuna delle sei variabili: sei righe «manca o è vuota», nell’ordine, uscita 2, pgbackrest non eseguito', () => {
    const run = runSummary({});
    expectProblems(run, VARIABLES.map(missing));
    expectNoValues(run);
  });

  it.each(VARIABLES)(
    'OPS-001, 00§4.2: senza %s: solo la sua riga «manca o è vuota», uscita 2, pgbackrest non eseguito',
    (name) => {
      const run = runSummary(variablesWith({ [name]: undefined }));
      expectProblems(run, [missing(name)]);
      expectNoValues(run);
    },
  );

  it.each(VARIABLES)(
    'OPS-001, 00§4.2: con %s vuota: solo la sua riga «manca o è vuota», uscita 2, pgbackrest non eseguito',
    (name) => {
      const run = runSummary(variablesWith({ [name]: '' }));
      expectProblems(run, [missing(name)]);
      expectNoValues(run);
    },
  );

  it.each(VARIABLES)(
    'OPS-001, 00§4.2: con CAMBIA nel valore di %s: solo la sua riga «contiene CAMBIA», senza il valore, uscita 2',
    (name) => {
      const value = `${VALID[name]}-CAMBIA`;
      const run = runSummary(variablesWith({ [name]: value }));
      expectProblems(run, [withCambia(name)]);
      expectNoValues(run, [...Object.values(VALID), value]);
    },
  );

  it('OPS-001, 00§4.2: con i valori dell’esempio infra/env.example/postgres.env: sei righe «contiene CAMBIA», nell’ordine', () => {
    const run = runSummary(EXAMPLE);
    expectProblems(run, VARIABLES.map(withCambia));
    expectNoValues(run, ['s3.CAMBIA.example']);
  });

  it('OPS-001, 00§4.2: un endpoint con https:// dà la riga «contiene ://», senza il valore, uscita 2', () => {
    const endpoint = 'https://VALORE-PROVA-SEGRETO-ENDPOINT.example';
    const run = runSummary(variablesWith({ PGBACKREST_REPO1_S3_ENDPOINT: endpoint }));
    expectProblems(run, [ENDPOINT_WITH_SCHEME]);
    expectNoValues(run, [...Object.values(VALID), endpoint]);
  });

  it('OPS-001, 00§4.2: l’endpoint https://s3.CAMBIA.example dà due righe, prima «contiene CAMBIA» e poi «contiene ://»', () => {
    const run = runSummary(variablesWith({ PGBACKREST_REPO1_S3_ENDPOINT: 'https://s3.CAMBIA.example' }));
    expectProblems(run, [withCambia('PGBACKREST_REPO1_S3_ENDPOINT'), ENDPOINT_WITH_SCHEME]);
    expectNoValues(run, [...Object.values(VALID), 'https://s3.CAMBIA.example', 's3.CAMBIA.example']);
  });

  it('OPS-001, 00§4.2: con più problemi una riga per problema, nell’ordine delle variabili', () => {
    const cipherPass = 'VALORE-PROVA-SEGRETO-CIFRATURA-CAMBIA';
    const run = runSummary(
      variablesWith({
        PGBACKREST_REPO1_S3_ENDPOINT: 'https://s3.CAMBIA.example',
        PGBACKREST_REPO1_S3_REGION: '',
        PGBACKREST_REPO1_S3_KEY: undefined,
        PGBACKREST_REPO1_CIPHER_PASS: cipherPass,
      }),
    );
    expectProblems(run, [
      withCambia('PGBACKREST_REPO1_S3_ENDPOINT'),
      ENDPOINT_WITH_SCHEME,
      missing('PGBACKREST_REPO1_S3_REGION'),
      missing('PGBACKREST_REPO1_S3_KEY'),
      withCambia('PGBACKREST_REPO1_CIPHER_PASS'),
    ]);
    expectNoValues(run, [...Object.values(VALID), 's3.CAMBIA.example', cipherPass]);
  });

  it('OPS-001, 00§4.2: «cambia» minuscolo e :// fuori dall’endpoint sono accettati: pgbackrest viene eseguito e i valori non compaiono', () => {
    const variables = variablesWith({
      PGBACKREST_REPO1_S3_BUCKET: 'VALORE-PROVA-SEGRETO-cambia-bucket',
      PGBACKREST_REPO1_CIPHER_PASS: 'VALORE-PROVA-SEGRETO://cifratura',
    });
    const run = runSummary(variables);
    expectSummary(run, 'stanza 1\n');
    expectNoValues(run, Object.values(variables));
  });

  it('OPS-001, 00§4.2: valori validi con spazi e caratteri speciali della shell: pgbackrest viene eseguito, e i valori non si stampano né si eseguono', () => {
    const marker = join(root, 'eseguito');
    const variables = variablesWith({
      PGBACKREST_REPO1_S3_BUCKET: 'VALORE-PROVA-SEGRETO bucket con spazi',
      PGBACKREST_REPO1_S3_REGION: 'VALORE-PROVA-SEGRETO-*?[a]',
      PGBACKREST_REPO1_S3_KEY: '-VALORE-PROVA-SEGRETO-%s%n\\t',
      PGBACKREST_REPO1_S3_KEY_SECRET: `VALORE-PROVA-SEGRETO-$(touch ${marker})\`touch ${marker}\`'"`,
      PGBACKREST_REPO1_CIPHER_PASS: 'VALORE-PROVA-SEGRETO+/=;|&<>',
    });
    const run = runSummary(variables);
    expectSummary(run, 'stanza 1\n');
    expectNoValues(run, Object.values(variables));
    expect(existsSync(marker), 'un valore eseguito come comando').toBe(false);
  });
});

describe('pgbackrest-summary: il riassunto di pgbackrest info', () => {
  it.each([
    { title: 'la stanza manca (codice 1)', stdout: `${STANZA_MISSING}\n`, line: 'stanza 1' },
    {
      title: 'nessun backup valido (codice 2)',
      stdout: `${info(stanza({ code: 2, message: 'no valid backups' }))}\n`,
      line: 'stanza 2',
    },
    {
      title: 'mancano i dati della stanza (codice 3)',
      stdout: `${info(stanza({ code: 3, message: 'missing stanza data', dbs: [] }))}\n`,
      line: 'stanza 3',
    },
    {
      // Caso irrealistico che prova la regola: il tipo tra parentesi quadre del messaggio del repository si aggiunge
      // solo con il codice 99.
      title: 'codice 3 e un [Tipo] nel repository',
      stdout: `${info(stanza({ code: 3, message: 'missing stanza data', repoMessage: '[FileMissingError] unable to open missing file', dbs: [] }))}\n`,
      line: 'stanza 3',
    },
  ])('OPS-001: $title: stampa solo «$line», uscita 0', ({ stdout, line }) => {
    pgbackrestAnswers(stdout);
    const run = runSummary();
    expectSummary(run, `${line}\n`);
    expectNotCopied(run, stdout);
    expectNoValues(run);
  });

  it.each([
    { title: '[ProtocolError] con il 403 del bucket', repoMessage: PROTOCOL_ERROR, line: 'stanza 99 [ProtocolError]' },
    {
      title: '[HostConnectError] con l’host',
      repoMessage:
        "[HostConnectError] unable to connect to 'VALORE-PROVA-HOST-BUCKET.fsn1.example:443 (192.0.2.10)': [111] Connection refused",
      line: 'stanza 99 [HostConnectError]',
    },
    {
      title: 'senza tipo tra parentesi quadre',
      repoMessage: 'HTTP request failed with 403 (Forbidden): host: VALORE-PROVA-HOST-BUCKET.fsn1.example',
      line: 'stanza 99',
    },
    {
      title: 'tra parentesi un host, non un tipo',
      repoMessage: '[VALORE-PROVA-HOST-BUCKET.fsn1.example] HTTP request failed with 403 (Forbidden)',
      line: 'stanza 99',
    },
    {
      // Il tipo conta solo all'inizio del messaggio, non all'inizio di una riga successiva.
      title: 'con il [Tipo] solo su una riga dopo',
      repoMessage: 'HTTP request failed with 403 (Forbidden):\n[ProtocolError] VALORE-PROVA-HOST-BUCKET.fsn1.example',
      line: 'stanza 99',
    },
  ])(
    'OPS-001, 00§4.2: codice 99, messaggio del repository $title: stampa solo «$line», mai il resto del messaggio, uscita 0',
    ({ repoMessage, line }) => {
      const stdout = `${info(stanza({ code: 99, message: 'other', repoMessage, dbs: [] }))}\n`;
      pgbackrestAnswers(stdout);
      const run = runSummary();
      expectSummary(run, `${line}\n`);
      for (const text of ['VALORE-PROVA', '403', 'HTTP', 'Forbidden', 'redacted', 'Connection', '192.0.2.10']) {
        expect(run.stdout).not.toContain(text);
        expect(run.stderr).not.toContain(text);
      }
      expectNotCopied(run, stdout);
      expectNoValues(run);
    },
  );

  it.each<{ title: string; stdout: string; stderr?: string; lines: string }>([
    { title: 'un completo e un differenziale', stdout: `${FULL_AND_DIFF}\n`, lines: FULL_AND_DIFF_LINES },
    {
      title: 'due database (dopo stanza-upgrade)',
      stdout: `${info(
        stanza({
          code: 0,
          message: 'ok',
          dbs: [1, 2],
          backups: [
            backup({ label: '20261122-033001F', type: 'full', repositoryDelta: 5_234_567_890, start: 1_795_314_601 }),
            backup({ ...FULL, db: 2 }),
            backup({ ...DIFF, db: 2 }),
          ],
        }),
      )}\n`,
      lines: `stanza 0\nbackup 20261122-033001F full 5234567890\n${FULL_AND_DIFF_LINES.replace('stanza 0\n', '')}`,
    },
    {
      title: 'un avviso prima del JSON',
      stdout: `${WARNING}\n${FULL_AND_DIFF}\n`,
      lines: FULL_AND_DIFF_LINES,
    },
    { title: 'una riga vuota dopo il JSON', stdout: `${FULL_AND_DIFF}\n\n`, lines: FULL_AND_DIFF_LINES },
    {
      // L'errore standard di pgbackrest può passare, ma non si legge: il JSON è l'ultima riga dell'uscita standard.
      title: 'un avviso su stderr dopo il JSON',
      stdout: `${FULL_AND_DIFF}\n`,
      stderr: `${WARNING}\n`,
      lines: FULL_AND_DIFF_LINES,
    },
  ])(
    'OPS-003: $title: la riga della stanza e una riga «backup <etichetta> <tipo> <byte nel repository>» per backup, nell’ordine',
    ({ stdout, stderr = '', lines }) => {
      pgbackrestAnswers(stdout, 0, stderr);
      const run = runSummary();
      expectSummary(run, lines);
      expectNotCopied(run, stdout);
      expectNoValues(run);
    },
  );

  it.each([
    {
      title: 'JSON troncato',
      stdout:
        '[{"archive":[],"backup":[],"cipher":"aes-256-cbc","db":[],"name":"main","repo":[{"cipher":"aes-256-cbc","key":1,"status":{"code":99,"message":"[ProtocolError] VALORE-PROVA-HOST-TRONCATO\n',
    },
    { title: 'nessuna uscita', stdout: '' },
    { title: 'solo righe vuote', stdout: '\n\n' },
    { title: 'un array vuoto', stdout: '[]\n' },
    { title: 'la stanza fuori da un array', stdout: `${JSON.stringify(stanza({ code: 0, message: 'ok' }))}\n` },
    {
      title: 'una stanza senza status.code',
      stdout: `${info(changed(stanza({ code: 2, message: 'no valid backups' }), ['status', 'code'], undefined))}\n`,
    },
    {
      title: 'status.code come testo',
      stdout: `${info(changed(stanza({ code: 2, message: 'no valid backups' }), ['status', 'code'], '2'))}\n`,
    },
    { title: 'solo un avviso, senza JSON', stdout: `${WARNING}\n` },
    { title: 'un avviso dopo il JSON (ultima riga)', stdout: `${FULL_AND_DIFF}\n${WARNING}\n` },
  ])(
    'OPS-001: risposta non riconosciuta ($title): uscita 1, stdout vuoto, la riga «risposta di pgbackrest info non riconosciuta»',
    ({ stdout }) => {
      pgbackrestAnswers(stdout);
      const run = runSummary();
      expectFailure(run, UNRECOGNISED);
      expectNotCopied(run, stdout);
      expectNoValues(run);
    },
  );

  const AFTER_VALID = 'dopo uno valido';
  const BEFORE_VALID = 'prima di uno valido';
  it.each([
    {
      title: 'senza info.repository.delta',
      path: ['info', 'repository', 'delta'],
      value: undefined,
      where: AFTER_VALID,
    },
    {
      title: 'con info.repository.delta come testo',
      path: ['info', 'repository', 'delta'],
      value: '2345',
      where: AFTER_VALID,
    },
    { title: 'senza label', path: ['label'], value: undefined, where: AFTER_VALID },
    { title: 'senza type', path: ['type'], value: undefined, where: AFTER_VALID },
    {
      title: 'senza info.repository.delta',
      path: ['info', 'repository', 'delta'],
      value: undefined,
      where: BEFORE_VALID,
    },
  ])(
    'OPS-003: un backup $title, $where: uscita 1, stdout vuoto (nemmeno le righe valide), la riga «non riconosciuta»',
    ({ path, value, where }) => {
      const backups =
        where === BEFORE_VALID
          ? [changed(backup(FULL), path, value), backup(DIFF)]
          : [backup(FULL), changed(backup(DIFF), path, value)];
      const stdout = `${info(stanza({ code: 0, message: 'ok', backups }))}\n`;
      pgbackrestAnswers(stdout);
      const run = runSummary();
      expectFailure(run, UNRECOGNISED);
      expectNotCopied(run, stdout);
      expectNoValues(run);
    },
  );

  it.each([
    { code: 37, stdout: 'ERROR: [037]: info command requires option: repo1-s3-region VALORE-PROVA-HOST\n' },
    { code: 1, stdout: `${FULL_AND_DIFF}\n` },
  ])(
    'OPS-001, 00§4.2: se pgbackrest info termina con $code: uscita 1, stdout vuoto, la riga con il codice, niente della sua uscita standard',
    ({ code, stdout }) => {
      pgbackrestAnswers(stdout, code);
      const run = runSummary();
      expectFailure(run, exitedWith(code));
      expectNotCopied(run, stdout);
      expectNoValues(run);
    },
  );

  it('OPS-001: legge la risposta con il jq del PATH', () => {
    // Un jq finto primo nel PATH: segna la chiamata e passa al jq del computer, con gli stessi argomenti e lo stesso
    // standard input.
    const jqCalls = join(root, 'chiamate-jq');
    writeFileSync(
      join(binDir, 'jq'),
      `#!/bin/sh
printf 'jq\\n' >> ${shellQuote(jqCalls)}
if [ -x /usr/bin/jq ]; then exec /usr/bin/jq "$@"; fi
exec /bin/jq "$@"
`,
    );
    chmodSync(join(binDir, 'jq'), 0o755);
    pgbackrestAnswers(`${FULL_AND_DIFF}\n`);
    const run = runSummary();
    expectSummary(run, FULL_AND_DIFF_LINES);
    expect(
      linesOf(existsSync(jqCalls) ? readFileSync(jqCalls, 'utf8') : '').length,
      'chiamate al jq del PATH',
    ).toBeGreaterThan(0);
  });
});
