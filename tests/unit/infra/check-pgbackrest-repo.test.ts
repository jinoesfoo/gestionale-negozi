import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// La prova del bucket sui server (08 §Compiti, OPS-T01a, note del piano, «Prova del bucket sui server»):
// infra/scripts/check-pgbackrest-repo.sh esegue pgbackrest-summary una volta, con
// `"$DC" run --rm --no-deps -T pgbackrest-init pgbackrest-summary` (DC assente o vuota: /srv/app/dc; il servizio
// pgbackrest-init è in 01 §Servizi Docker Compose), e stampa solo «riuscito» (stanza con codice 0, 1 o 2, uscita 0) o
// «fallito» (uscita 1), con il codice della stanza e, per il 99, il tipo d'errore; con l'uscita 2 del riassunto, prima
// di «fallito», ristampa le sole righe che nominano una variabile di postgres.env e il suo problema. Nient'altro arriva
// all'uscita o agli errori (00 §4.2): le altre righe del riassunto, i messaggi di pgBackRest e gli errori di Compose
// possono contenere host, bucket e dettagli. Lo script gira con `bash`, come sui server (Claude lo lancia con
// `ssh test bash /srv/app/infra/scripts/check-pgbackrest-repo.sh`), con un dc finto nella cartella temporanea, che
// scrive gli argomenti ricevuti e risponde con l'uscita, gli errori e il codice scelti dal caso, e con un docker finto
// che non va mai chiamato. Mai docker, ssh o rete veri.

const SCRIPT = fileURLToPath(new URL('../../../infra/scripts/check-pgbackrest-repo.sh', import.meta.url));
/** Il dc dei server, usato quando DC manca o è vuota: qui non esiste, quindi la chiamata fallisce con 127. */
const DEFAULT_DC = '/srv/app/dc';
/** Gli argomenti dell'unica chiamata a "$DC". */
const DC_ARGS = ['run', '--rm', '--no-deps', '-T', 'pgbackrest-init', 'pgbackrest-summary'];

const OK_0 = 'riuscito: bucket raggiungibile, stanza con backup (codice 0)';
const OK_1 = 'riuscito: bucket raggiungibile, stanza assente (codice 1)';
const OK_2 = 'riuscito: bucket raggiungibile, stanza senza backup (codice 2)';
const UNRECOGNISED = 'fallito: risposta di pgbackrest-summary non riconosciuta';
const BAD_CONFIG = 'fallito: configurazione di pgBackRest non valida in postgres.env';
const stanzaFailed = (code: string) => `fallito: stanza con codice ${code}`;
const exitFailed = (status: number) => `fallito: pgbackrest-summary o docker compose terminato con codice ${status}`;

/** Uscite di pgbackrest-summary nella forma del contratto: `stanza <codice>`, poi una riga per backup. */
const SUMMARY_0 =
  'stanza 0\nbackup 20261129-033001F full 4123456\nbackup 20261129-033001F_20261130-033002D diff 812345\n';
const SUMMARY_1 = 'stanza 1\n';
const SUMMARY_2 = 'stanza 2\n';

/** Le sei variabili che pgbackrest-summary controlla e i tre problemi che può nominare. */
const VARIABLES = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_KEY', 'S3_KEY_SECRET', 'CIPHER_PASS'].map(
  (name) => `PGBACKREST_REPO1_${name}`,
);
const PROBLEMS = ['manca o è vuota', 'contiene CAMBIA', 'contiene ://'];
const problemLine = (variable: string, problem: string) => `pgbackrest-summary: ${variable}: ${problem}`;
/** Le 18 righe che l'uscita 2 ristampa: nome della variabile e problema, mai un valore. */
const PROBLEM_LINES = VARIABLES.flatMap((variable) => PROBLEMS.map((problem) => problemLine(variable, problem)));
const KEY_MISSING = problemLine('PGBACKREST_REPO1_S3_KEY', 'manca o è vuota');

/** Righe simili a quelle che l'uscita 2 ristampa, ma non uguali: non si ristampano. */
const NEAR_MISSES = [
  'pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: manca o è vuota: VALORE-PROVA-SEGRETO-CHIAVE',
  'VALORE-PROVA-SEGRETO-CHIAVE pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: manca o è vuota',
  'pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: VALORE-PROVA-SEGRETO-CHIAVE',
  'pgbackrest-summary: PGBACKREST_REPO1_S3_ENDPOINT: contiene :// VALORE-PROVA-HOST',
  'pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: manca o è vuota ',
  ' pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: manca o è vuota',
  'pgbackrest-summary: PGBACKREST_REPO1_S3_KEY:  manca o è vuota',
  'pgbackrest-summary: PGBACKREST_REPO1_S3_KEYS: manca o è vuota',
  'pgbackrest-summary: PGBACKREST_REPO2_S3_KEY: manca o è vuota',
  'pgbackrest-summary: PGBACKREST_REPO1_S3_URI_STYLE: manca o è vuota',
  'pgbackrest-summary: pgbackrest_repo1_s3_key: manca o è vuota',
  'Pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: manca o è vuota',
  'pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: contiene cambia',
  'pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: manca o e vuota',
  'pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: manca',
  'pgbackrest-summary: configurazione non valida',
];

/** Il segno dei valori che non devono mai arrivare all'uscita: segreti, host e bucket finti. */
const LEAK_MARK = 'VALORE-PROVA';
const SECRET_LINE = 'VALORE-PROVA-SEGRETO-CHIAVE-S3';
const HOST_ERROR =
  'ERROR: [039]: HTTP request failed with 403 (Forbidden): host VALORE-PROVA-HOST, bucket VALORE-PROVA-BUCKET';
/** Righe del riassunto dopo la prima: avvisi ed errori di pgBackRest, un segreto. */
const STDOUT_NOISE = [
  "WARN: environment contains invalid option 'repo1-s3-key-secret=VALORE-PROVA-SEGRETO-AMBIENTE'",
  HOST_ERROR,
  SECRET_LINE,
]
  .map((line) => `${line}\n`)
  .join('');
/** Errori di Compose e di pgBackRest sugli errori della chiamata. */
const STDERR_NOISE = [
  ' Container app-pgbackrest-init-run-1  Creating',
  'time="2026-11-26T03:30:00Z" level=warning msg="host VALORE-PROVA-HOST non raggiungibile"',
  HOST_ERROR,
  SECRET_LINE,
]
  .map((line) => `${line}\n`)
  .join('');

/** La risposta del dc finto: uscita, errori e codice di uscita. */
interface Answer {
  stdout?: string;
  stderr?: string;
  status?: number;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Gli argomenti di ogni chiamata al dc finto. */
  dcCalls: string[][];
  /** Gli argomenti di ogni chiamata al docker finto (nessuna, sempre). */
  dockerCalls: string[][];
}

let root: string;
let binDir: string;
let fakeDc: string;
/** La cartella temporanea dei casi che controllano il file degli errori (TMPDIR dello script). */
let checkTmp: string;

/** Una parola per sh, tra apici singoli. */
const sh = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * Il dc finto: aggiunge in dc-calls una registrazione per chiamata (ogni argomento chiuso da \x1f, la registrazione
 * chiusa da \x1e), annota in tmp-durante cosa c'è in checkTmp mentre gira, scrive dc-stderr sugli errori e poi
 * dc-stdout sull'uscita (come Compose, che scrive le sue righe prima di quelle del container: uno script che unisse i
 * due flussi leggerebbe come prima riga una riga degli errori) ed esce con il codice scritto in dc-status.
 */
function fakeDcScript(): string {
  const file = (name: string) => sh(join(root, name));
  return [
    '#!/bin/sh',
    `for a in "$@"; do printf '%s\\037' "$a"; done >> ${file('dc-calls')}`,
    `printf '\\036' >> ${file('dc-calls')}`,
    `ls -A ${sh(checkTmp)} > ${file('tmp-durante')}`,
    `cat ${file('dc-stderr')} >&2`,
    `cat ${file('dc-stdout')}`,
    `exit "$(cat ${file('dc-status')})"`,
    '',
  ].join('\n');
}

/** Il docker finto: registra la chiamata come il dc finto ed esce con 99. Lo script non lo deve mai chiamare. */
function fakeDockerScript(): string {
  const calls = sh(join(root, 'docker-calls'));
  return [
    '#!/bin/sh',
    `for a in "$@"; do printf '%s\\037' "$a"; done >> ${calls}`,
    `printf '\\036' >> ${calls}`,
    'exit 99',
    '',
  ].join('\n');
}

function respond({ stdout = '', stderr = '', status = 0 }: Answer): void {
  writeFileSync(join(root, 'dc-stdout'), stdout);
  writeFileSync(join(root, 'dc-stderr'), stderr);
  writeFileSync(join(root, 'dc-status'), String(status));
}

function readCalls(file: string): string[][] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\x1e')
    .slice(0, -1)
    .map((record) => record.split('\x1f').slice(0, -1));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ops-t01a-check-repo-'));
  binDir = join(root, 'bin');
  checkTmp = join(root, 'tmp');
  fakeDc = join(root, 'dc');
  mkdirSync(binDir);
  mkdirSync(checkTmp);
  writeFileSync(fakeDc, fakeDcScript());
  chmodSync(fakeDc, 0o755);
  writeFileSync(join(binDir, 'docker'), fakeDockerScript());
  chmodSync(join(binDir, 'docker'), 0o755);
  respond({});
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Esegue lo script con `bash`, come sui server; `vars` sono le variabili del caso (di solito DC, il dc finto). */
function runCheck(vars: Record<string, string> = { DC: fakeDc }): Run {
  const childEnv: Record<string, string> = { PATH: `${binDir}:/usr/bin:/bin`, TMPDIR: tmpdir(), ...vars };
  const result = spawnSync('bash', [SCRIPT], {
    // Nella cartella temporanea: un file lasciato nella cartella corrente non finisce nel repository.
    cwd: root,
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
    dcCalls: readCalls(join(root, 'dc-calls')),
    dockerCalls: readCalls(join(root, 'docker-calls')),
  };
}

/** L'uscita è esattamente `lines`, gli errori sono vuoti, "$DC" è chiamato una volta con DC_ARGS e docker mai. */
function expectResult(run: Run, status: number, lines: string[]): void {
  expect(run.stdout).toBe(lines.map((line) => `${line}\n`).join(''));
  expect(run.stderr).toBe('');
  expect(run.status).toBe(status);
  expect(run.dcCalls).toEqual([DC_ARGS]);
  expect(run.dockerCalls).toEqual([]);
}

function expectNoDefaultDc(): void {
  expect(existsSync(DEFAULT_DC), `${DEFAULT_DC} esiste su questo computer: la prova chiamerebbe il dc vero`).toBe(
    false,
  );
}

describe('prova del bucket sui server (infra/scripts/check-pgbackrest-repo.sh)', () => {
  it('OPS-001: è uno script bash eseguibile', () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
    expect(['#!/usr/bin/env bash', '#!/bin/bash']).toContain(readFileSync(SCRIPT, 'utf8').split('\n')[0]);
  });

  it('OPS-001: chiama una volta sola "$DC" run --rm --no-deps -T pgbackrest-init pgbackrest-summary, mai docker', () => {
    respond({ stdout: SUMMARY_1 });
    const run = runCheck();
    expect(run.dcCalls).toEqual([DC_ARGS]);
    expect(run.dockerCalls).toEqual([]);
  });

  // Nei casi con l'uscita 0 gli errori hanno una riga di variabile: si ristampa solo con l'uscita 2. Il dc finto la
  // scrive prima dell'uscita, quindi uno script che unisse i due flussi non troverebbe la stanza nella prima riga.
  it.each([
    { first: 'stanza 1', outcome: 'stanza assente', summary: SUMMARY_1, expected: OK_1 },
    { first: 'stanza 2', outcome: 'stanza senza backup', summary: SUMMARY_2, expected: OK_2 },
    { first: 'stanza 0', outcome: 'stanza con backup', summary: SUMMARY_0, expected: OK_0 },
  ])(
    'OPS-001: uscita 0 e prima riga «$first»: stampa solo «riuscito: bucket raggiungibile, $outcome (…)» ed esce con 0',
    ({ summary, expected }) => {
      respond({ stdout: summary, stderr: `${KEY_MISSING}\n` });
      expectResult(runCheck(), 0, [expected]);
    },
  );

  it.each([
    { first: 'stanza 3', code: '3' },
    { first: 'stanza 4', code: '4' },
    { first: 'stanza 5', code: '5' },
    { first: 'stanza 6', code: '6' },
    { first: 'stanza 10', code: '10' },
    { first: 'stanza 20', code: '20' },
    { first: 'stanza 99', code: '99' },
    { first: 'stanza 99 [ProtocolError]', code: '99 [ProtocolError]' },
    { first: 'stanza 99 [HostConnectError]', code: '99 [HostConnectError]' },
    { first: 'stanza 5 [FormatError]', code: '5 [FormatError]' },
  ])(
    'OPS-001: uscita 0 e prima riga «$first»: stampa solo «fallito: stanza con codice $code» ed esce con 1',
    ({ first, code }) => {
      respond({ stdout: `${first}\n`, stderr: `${KEY_MISSING}\n` });
      expectResult(runCheck(), 1, [stanzaFailed(code)]);
    },
  );

  it.each([
    { label: 'uscita vuota', summary: '' },
    { label: 'prima riga vuota', summary: '\nstanza 1\n' },
    { label: 'un avviso prima della stanza', summary: 'WARN: avviso di pgBackRest\nstanza 1\n' },
    { label: 'un errore di pgBackRest', summary: 'ERROR: [039]: HTTP request failed with 403 (Forbidden)\n' },
    { label: 'una riga di backup', summary: 'backup 20261129-033001F full 4123456\n' },
    { label: 'stanza senza codice', summary: 'stanza\n' },
    { label: 'codice in lettere', summary: 'stanza uno\n' },
    { label: 'iniziale maiuscola', summary: 'Stanza 1\n' },
    { label: 'codice negativo', summary: 'stanza -1\n' },
  ])(
    'OPS-001: uscita 0 e prima riga non riconosciuta ($label): stampa solo «fallito: risposta … non riconosciuta» ed esce con 1',
    ({ summary }) => {
      respond({ stdout: summary, stderr: `${KEY_MISSING}\n` });
      expectResult(runCheck(), 1, [UNRECOGNISED]);
    },
  );

  it.each([
    { first: 'stanza 1.5', hidden: '1.5' },
    { first: 'stanza 1x', hidden: '1x' },
    { first: 'stanza 99 [Protocol Error]', hidden: 'Protocol Error' },
    { first: 'stanza 99 [Protocol_Error]', hidden: 'Protocol_Error' },
    { first: 'stanza 99 [ProtocolError', hidden: 'ProtocolError' },
    { first: 'stanza 99 ProtocolError', hidden: 'ProtocolError' },
    { first: 'stanza 99 []', hidden: '[]' },
    { first: 'stanza 99 [ProtocolError] dettaglio', hidden: 'dettaglio' },
  ])(
    'OPS-001: uscita 0 e prima riga «$first», fuori dalla forma «stanza <n> [<Tipo>]»: una sola riga «fallito», senza «$hidden», uscita 1',
    ({ first, hidden }) => {
      respond({ stdout: `${first}\n` });
      const run = runCheck();
      expect(run.stdout).toMatch(/^fallito: [^\n]*\n$/);
      expect(run.stdout).not.toContain(hidden);
      expect(run.stderr).toBe('');
      expect(run.status).toBe(1);
      expect(run.dcCalls).toEqual([DC_ARGS]);
      expect(run.dockerCalls).toEqual([]);
    },
  );

  it('OPS-001: uscita 2: ristampa nell’ordine solo le righe esatte «pgbackrest-summary: <variabile>: <problema>», poi «fallito: configurazione…», uscita 1', () => {
    const reprinted = [...PROBLEM_LINES].reverse();
    // Le 18 righe da ristampare, in un ordine diverso da quello del contratto, fra errori di Compose e righe simili.
    const stderrLines = reprinted.flatMap((line, i) => [line, ...NEAR_MISSES.slice(i, i + 1)]);
    respond({
      stdout: `${SUMMARY_1}${STDOUT_NOISE}`,
      stderr: `${STDERR_NOISE}${stderrLines.map((line) => `${line}\n`).join('')}`,
      status: 2,
    });
    expectResult(runCheck(), 1, [...reprinted, BAD_CONFIG]);
  });

  it('OPS-001: uscita 2 senza righe di variabili sugli errori: solo «fallito: configurazione…», anche con «stanza 1» e una riga di variabile sull’uscita, uscita 1', () => {
    respond({
      // Si ristampano solo le righe degli errori: quella sull'uscita no.
      stdout: `${SUMMARY_1}${KEY_MISSING}\n`,
      stderr: `${STDERR_NOISE}${NEAR_MISSES.map((line) => `${line}\n`).join('')}`,
      status: 2,
    });
    expectResult(runCheck(), 1, [BAD_CONFIG]);
  });

  it.each([1, 3, 64, 125, 126, 127, 130, 255].map((status) => ({ status })))(
    'OPS-001: uscita $status del riassunto o di Compose: solo «fallito: … terminato con codice $status», anche con «stanza 1» e una riga di variabile, uscita 1',
    ({ status }) => {
      respond({ stdout: SUMMARY_1, stderr: `${KEY_MISSING}\n`, status });
      expectResult(runCheck(), 1, [exitFailed(status)]);
    },
  );

  it.each<{ label: string; vars: Record<string, string> }>([
    { label: 'senza DC', vars: {} },
    { label: 'con DC vuota', vars: { DC: '' } },
  ])(
    'OPS-001: $label usa /srv/app/dc, che qui non esiste: solo «fallito: … terminato con codice 127», uscita 1, nessun messaggio della shell',
    ({ vars }) => {
      expectNoDefaultDc();
      respond({ stdout: SUMMARY_1 });
      const run = runCheck(vars);
      expect(run.stdout).toBe(`${exitFailed(127)}\n`);
      expect(run.stderr).toBe('');
      expect(run.status).toBe(1);
      expect(run.dcCalls).toEqual([]);
      expect(run.dockerCalls).toEqual([]);
    },
  );

  it.each<{ label: string; answer: Answer }>([
    { label: 'stanza assente', answer: { stdout: SUMMARY_1 } },
    { label: 'codice 99', answer: { stdout: 'stanza 99 [ProtocolError]\n' } },
    { label: 'risposta non riconosciuta', answer: { stdout: `${HOST_ERROR}\n` } },
    { label: 'uscita 2', answer: { stderr: `${KEY_MISSING}\n`, status: 2 } },
    { label: 'uscita 3', answer: { stderr: STDERR_NOISE, status: 3 } },
  ])(
    'OPS-001: $label: il file temporaneo degli errori sta in TMPDIR durante la chiamata e non resta dopo',
    ({ answer }) => {
      respond(answer);
      const run = runCheck({ DC: fakeDc, TMPDIR: checkTmp });
      expect(run.dcCalls).toEqual([DC_ARGS]);
      expect(readFileSync(join(root, 'tmp-durante'), 'utf8').trim()).not.toBe('');
      expect(readdirSync(checkTmp)).toEqual([]);
    },
  );

  it('OPS-001: DC assente o vuota vale /srv/app/dc: lo script assegna DC="${DC:-/srv/app/dc}"', () => {
    // Con DC vuota anche `${DC-/srv/app/dc}` (senza i due punti) fallisce con 127, perché esegue un comando vuoto, e lo
    // script non stampa i messaggi della shell: la differenza non si vede dal comportamento, quindi si legge il testo.
    const lines = readFileSync(SCRIPT, 'utf8')
      .split('\n')
      .map((line) => line.trim());
    expect(lines).toContain('DC="${DC:-/srv/app/dc}"');
  });

  it('OPS-001: senza DC (chiamata fallita con 127) non resta nessun file temporaneo', () => {
    expectNoDefaultDc();
    const run = runCheck({ TMPDIR: checkTmp });
    expect(run.status).toBe(1);
    expect(readdirSync(checkTmp)).toEqual([]);
  });

  it.each<{ label: string; answer: Answer; status: number; lines: string[] }>([
    {
      label: 'stanza assente',
      answer: { stdout: `${SUMMARY_1}${STDOUT_NOISE}`, stderr: STDERR_NOISE },
      status: 0,
      lines: [OK_1],
    },
    {
      label: 'stanza senza backup',
      answer: { stdout: `${SUMMARY_2}${STDOUT_NOISE}`, stderr: STDERR_NOISE },
      status: 0,
      lines: [OK_2],
    },
    {
      label: 'stanza con backup',
      answer: { stdout: `${SUMMARY_0}${STDOUT_NOISE}`, stderr: STDERR_NOISE },
      status: 0,
      lines: [OK_0],
    },
    {
      label: 'codice 99',
      answer: { stdout: `stanza 99 [ProtocolError]\n${STDOUT_NOISE}`, stderr: STDERR_NOISE },
      status: 1,
      lines: [stanzaFailed('99 [ProtocolError]')],
    },
    {
      label: 'codice 3',
      answer: { stdout: `stanza 3\n${STDOUT_NOISE}`, stderr: STDERR_NOISE },
      status: 1,
      lines: [stanzaFailed('3')],
    },
    {
      label: 'errore di pgBackRest come prima riga',
      answer: { stdout: `${HOST_ERROR}\n${SUMMARY_1}${STDOUT_NOISE}`, stderr: STDERR_NOISE },
      status: 1,
      lines: [UNRECOGNISED],
    },
    {
      label: 'segreto come prima riga',
      answer: { stdout: `${SECRET_LINE}\n${SUMMARY_1}${STDOUT_NOISE}`, stderr: STDERR_NOISE },
      status: 1,
      lines: [UNRECOGNISED],
    },
    {
      // Un byte nullo nell'uscita catturata: neanche l'avviso della shell arriva agli errori.
      label: 'byte nullo dopo la prima riga',
      answer: { stdout: `${SUMMARY_1}\0${SECRET_LINE}\n${STDOUT_NOISE}`, stderr: STDERR_NOISE },
      status: 0,
      lines: [OK_1],
    },
    {
      label: 'uscita 2',
      answer: {
        stdout: `${SUMMARY_1}${STDOUT_NOISE}`,
        stderr: `${STDERR_NOISE}${KEY_MISSING}\n${NEAR_MISSES.map((line) => `${line}\n`).join('')}`,
        status: 2,
      },
      status: 1,
      lines: [KEY_MISSING, BAD_CONFIG],
    },
    {
      label: 'uscita 1 del riassunto',
      answer: { stdout: `${SUMMARY_1}${STDOUT_NOISE}`, stderr: STDERR_NOISE, status: 1 },
      status: 1,
      lines: [exitFailed(1)],
    },
    {
      label: 'errore di Compose',
      answer: {
        stdout: STDOUT_NOISE,
        stderr: `Error response from daemon: Get "https://VALORE-PROVA-HOST/v2/": dial tcp: lookup VALORE-PROVA-HOST\n${STDERR_NOISE}`,
        status: 125,
      },
      status: 1,
      lines: [exitFailed(125)],
    },
  ])(
    'OPS-001, 00§4.2: $label: nessuna riga del riassunto, di pgBackRest o di Compose arriva all’uscita o agli errori',
    ({ answer, status, lines }) => {
      respond(answer);
      const run = runCheck();
      expect(run.stdout).not.toContain(LEAK_MARK);
      expect(run.stderr).not.toContain(LEAK_MARK);
      expectResult(run, status, lines);
    },
  );

  it('OPS-001, 00§4.2: prima riga «stanza 99 [ProtocolError]» seguita da host e bucket: una sola riga «fallito», senza valori', () => {
    respond({
      stdout: `stanza 99 [ProtocolError] host VALORE-PROVA-HOST bucket VALORE-PROVA-BUCKET\n${STDOUT_NOISE}`,
      stderr: STDERR_NOISE,
    });
    const run = runCheck();
    expect(run.stdout).toMatch(/^fallito: [^\n]*\n$/);
    expect(run.stdout).not.toContain(LEAK_MARK);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(1);
    expect(run.dcCalls).toEqual([DC_ARGS]);
    expect(run.dockerCalls).toEqual([]);
  });
});
