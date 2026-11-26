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

// pgbackrest-init (01 §Servizi, riga `pgbackrest-init`; 08 §Progetto «pgBackRest», «Primo avvio», e OPS-T01a, note del
// piano, «Script nell'immagine»; 01 FON-T07b, nota del piano di OPS-T01a): il comando del servizio Compose una
// tantum, nel repository infra/postgres/pgbackrest-init, nell'immagine /usr/local/bin/pgbackrest-init, uso
// `pgbackrest-init [<file indicatore>]`. Con il file indicatore (predefinito /var/lib/postgresql/.pgbackrest-stanza-ok,
// sul volume pgdata) stampa una sola riga ed esce con 0 senza contattare il bucket; altrimenti legge la stanza con
// pgbackrest-summary, esegue stanza-create solo con il codice 1, prosegue con 0 o 2 e si ferma con ogni altro codice,
// poi esegue check e scrive il file indicatore con un file temporaneo rinominato. Ogni riga dello script comincia con
// `pgbackrest-init: `; l'uscita di pgBackRest passa e può mescolarsi alle sue righe, quindi i test scelgono le righe
// con quel prefisso, e controllano che le altre righe vengano solo da pgbackrest o dall'errore standard del riassunto.
// I testi esatti delle righe li fissa questo test. Qui gira lo script vero, nella cartella / come nel container, con il
// file indicatore in una cartella temporanea tutta sua e due programmi finti primi nel PATH: pgbackrest-summary (stampa
// il riassunto scelto ed esce con il codice scelto) e pgbackrest (esce con il codice scelto per stanza-create o check e
// stampa le righe di inizio e di fine del comando come con --log-level-console=info). Mai un pgbackrest vero, mai la
// rete.

const INIT = fileURLToPath(new URL('../../../infra/postgres/pgbackrest-init', import.meta.url));
const DEFAULT_INDICATOR = '/var/lib/postgresql/.pgbackrest-stanza-ok';

const PREFIX = 'pgbackrest-init: ';
const INDICATOR_PRESENT = 'pgbackrest-init: file indicatore presente: nessuna chiamata al bucket';
const STANZA_CREATE = 'pgbackrest-init: stanza-create';
const CHECK = 'pgbackrest-init: check';
const WRITTEN = 'pgbackrest-init: file indicatore scritto';
const infoLine = (first: string): string => `pgbackrest-init: info: ${first}`;
const errorLine = (text: string): string => `pgbackrest-init: errore: ${text}`;

// --- I programmi finti e l'esecuzione dello script -------------------------------------------------------------------

/** Una stringa tra apici singoli per sh. */
const shellQuote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/** Le righe che registrano una chiamata in `file`: gli argomenti, ognuno chiuso da \037, e un \036 in fondo. */
const recordCall = (file: string): string =>
  `{ for arg in "$@"; do printf '%s\\037' "$arg"; done; printf '\\036'; } >> "$dir/${file}"`;

/**
 * Il pgbackrest-summary finto: registra la chiamata, stampa `riassunto` sull'uscita standard e `riassunto-errore`
 * sull'errore standard, ed esce con il codice scritto in `riassunto-codice`.
 */
function fakeSummary(dir: string): string {
  return `#!/bin/sh
dir=${shellQuote(dir)}
${recordCall('chiamate-pgbackrest-summary')}
cat "$dir/riassunto"
cat "$dir/riassunto-errore" >&2
exit "$(cat "$dir/riassunto-codice")"
`;
}

/**
 * Il pgbackrest finto: registra la chiamata; il comando è stanza-create o check, se è fra gli argomenti; esce con il
 * codice scritto in `codice-<comando>` (0 se il file manca) e stampa le righe di inizio e di fine del comando come
 * pgBackRest con --log-level-console=info, più una riga ERROR sull'errore standard quando fallisce.
 */
function fakePgbackrest(dir: string): string {
  return `#!/bin/sh
dir=${shellQuote(dir)}
${recordCall('chiamate-pgbackrest')}
cmd=altro
for arg in "$@"; do
  case "$arg" in
    stanza-create | check) cmd=$arg ;;
  esac
done
code=0
if [ -f "$dir/codice-$cmd" ]; then code=$(cat "$dir/codice-$cmd"); fi
echo "P00   INFO: $cmd command begin 2.60.1: --stanza=main"
if [ "$code" -eq 0 ]; then
  echo "P00   INFO: $cmd command end: completed successfully"
else
  printf 'P00  ERROR: [%03d]: %s non riuscito (pgbackrest finto)\\n' "$code" "$cmd" >&2
  printf 'P00   INFO: %s command end: aborted with exception [%03d]\\n' "$cmd" "$code"
fi
exit "$code"
`;
}

let root: string;
let binDir: string;
/** La cartella del file indicatore: dopo la scrittura non deve contenere nient'altro. */
let dataDir: string;
let indicator: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ops-t01a-init-'));
  binDir = join(root, 'bin');
  dataDir = join(root, 'pgdata');
  indicator = join(dataDir, '.pgbackrest-stanza-ok');
  mkdirSync(binDir);
  mkdirSync(dataDir);
  writeFileSync(join(binDir, 'pgbackrest-summary'), fakeSummary(root));
  writeFileSync(join(binDir, 'pgbackrest'), fakePgbackrest(root));
  chmodSync(join(binDir, 'pgbackrest-summary'), 0o755);
  chmodSync(join(binDir, 'pgbackrest'), 0o755);
  summaryAnswers('stanza 1\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Quello che stampa il pgbackrest-summary finto (uscita standard ed errore standard) e il suo codice di uscita. */
function summaryAnswers(stdout: string, code = 0, stderr = ''): void {
  writeFileSync(join(root, 'riassunto'), stdout);
  writeFileSync(join(root, 'riassunto-errore'), stderr);
  writeFileSync(join(root, 'riassunto-codice'), `${code}\n`);
}

/** Il codice di uscita del pgbackrest finto per un comando (0 se non è scritto). */
function pgbackrestExits(command: 'stanza-create' | 'check', code: number): void {
  writeFileSync(join(root, `codice-${command}`), `${code}\n`);
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

/** Le righe dello script: quelle che cominciano con `pgbackrest-init: `. */
const own = (text: string): string[] => linesOf(text).filter((line) => line.startsWith(PREFIX));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Gli argomenti di ogni chiamata a pgbackrest-summary in questa esecuzione. */
  summaryCalls: string[][];
  /** Gli argomenti di ogni chiamata a pgbackrest in questa esecuzione. */
  pgbackrestCalls: string[][];
}

/**
 * Lo script con gli argomenti dati (di solito il file indicatore della prova), nell'ambiente solo PATH e TMPDIR, nella
 * cartella / come nel container (l'immagine non ha WORKDIR): un file temporaneo scritto nella cartella corrente
 * invece che accanto al file indicatore lì fallirebbe, e qui pure.
 */
function runInit(args: string[] = [indicator]): Run {
  const summaryLog = join(root, 'chiamate-pgbackrest-summary');
  const pgbackrestLog = join(root, 'chiamate-pgbackrest');
  rmSync(summaryLog, { force: true });
  rmSync(pgbackrestLog, { force: true });
  const childEnv: Record<string, string> = { PATH: `${binDir}:/usr/bin:/bin`, TMPDIR: tmpdir() };
  const result = spawnSync(INIT, args, {
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
    summaryCalls: readCalls(summaryLog),
    pgbackrestCalls: readCalls(pgbackrestLog),
  };
}

// --- Controlli comuni ------------------------------------------------------------------------------------------------

/** Una chiamata a pgbackrest per `command`, con --stanza=main, --log-level-console=info e le opzioni date. */
function expectCommand(args: string[] | undefined, command: 'stanza-create' | 'check', options: string[] = []): void {
  expect(args).toEqual(expect.arrayContaining(['--stanza=main', '--log-level-console=info', ...options, command]));
  expect(args).not.toContain(command === 'check' ? 'stanza-create' : 'check');
}

/** Il file indicatore è stato scritto, e nella sua cartella non è rimasto nient'altro (né il file temporaneo). */
function expectIndicatorWritten(): void {
  expect(statSync(indicator).isFile()).toBe(true);
  expect(readdirSync(dataDir)).toEqual(['.pgbackrest-stanza-ok']);
}

/** Nessun file indicatore, e nella sua cartella nessun file temporaneo rimasto. */
function expectNoIndicator(): void {
  expect(readdirSync(dataDir), 'né il file indicatore né un file temporaneo').toEqual([]);
}

/**
 * Ogni riga dell'uscita è dello script (comincia con `pgbackrest-init: `) oppure è passata da pgbackrest (le righe
 * `P00 …` del finto) o dall'errore standard di pgbackrest-summary dato: mai, per esempio, le righe del riassunto, che
 * lo script riporta solo nella sua riga `info:`, e solo la prima.
 */
function expectOnlyOwnOrPassedLines(run: Run, summaryStderr = ''): void {
  const passed = linesOf(summaryStderr);
  for (const [stream, text] of [
    ['stdout', run.stdout],
    ['stderr', run.stderr],
  ] as const) {
    const others = linesOf(text).filter(
      (line) => !line.startsWith(PREFIX) && !line.startsWith('P00 ') && !passed.includes(line),
    );
    expect(others, `${stream}: righe che non sono dello script né passate da pgbackrest`).toEqual([]);
  }
}

// --- Test ------------------------------------------------------------------------------------------------------------

describe('pgbackrest-init (infra/postgres/pgbackrest-init)', () => {
  it('OPS-001: è uno script bash eseguibile', () => {
    expect(statSync(INIT).mode & 0o111).not.toBe(0);
    expect(['#!/usr/bin/env bash', '#!/bin/bash']).toContain(readFileSync(INIT, 'utf8').split('\n')[0]);
  });

  it('OPS-001: senza argomenti il file indicatore è /var/lib/postgresql/.pgbackrest-stanza-ok, sul volume pgdata', () => {
    expect(readFileSync(INIT, 'utf8')).toContain(DEFAULT_INDICATOR);
  });

  it('OPS-001: con il file indicatore presente stampa solo «file indicatore presente: nessuna chiamata al bucket» ed esce con 0, senza eseguire pgbackrest-summary né pgbackrest', () => {
    writeFileSync(indicator, '');
    const run = runInit();
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`${INDICATOR_PRESENT}\n`);
    // Nessun programma è partito: ogni riga sull'errore standard, se c'è, è dello script.
    for (const line of linesOf(run.stderr)) expect(line.startsWith(PREFIX), line).toBe(true);
    expect(run.summaryCalls).toEqual([]);
    expect(run.pgbackrestCalls).toEqual([]);
  });

  it('OPS-001: una cartella al posto del file indicatore non è il file indicatore (che è un file normale): esegue pgbackrest-summary', () => {
    mkdirSync(indicator);
    summaryAnswers('stanza 0\n');
    const run = runInit();
    expect(own(run.stdout)).not.toContain(INDICATOR_PRESENT);
    expect(run.summaryCalls).toEqual([[]]);
  });

  it('OPS-001: senza argomenti usa il file indicatore predefinito, che su questo computer non c’è: esegue pgbackrest-summary (qui fallisce, quindi niente da scrivere)', () => {
    summaryAnswers('', 2, 'pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: manca o è vuota\n');
    const run = runInit([]);
    expect(run.status).toBe(1);
    expect(own(run.stderr)).toEqual([errorLine('pgbackrest-summary terminato con codice 2')]);
    expect(run.summaryCalls).toEqual([[]]);
    expect(run.pgbackrestCalls).toEqual([]);
  });

  it('OPS-001: con la stanza assente (stanza 1) esegue stanza-create e poi check, scrive il file indicatore e stampa i passi nell’ordine', () => {
    summaryAnswers('stanza 1\n');
    const run = runInit();
    expect(run.status).toBe(0);
    expect(own(run.stdout)).toEqual([infoLine('stanza 1'), STANZA_CREATE, CHECK, WRITTEN]);
    expectOnlyOwnOrPassedLines(run);
    expect(run.summaryCalls, 'pgbackrest-summary una volta, senza argomenti').toEqual([[]]);
    expect(run.pgbackrestCalls).toHaveLength(2);
    expectCommand(run.pgbackrestCalls[0], 'stanza-create');
    expectCommand(run.pgbackrestCalls[1], 'check', ['--archive-timeout=300']);
    expectIndicatorWritten();
    // L'uscita di pgBackRest arriva ai log di Docker.
    const output = `${run.stdout}${run.stderr}`;
    expect(output).toContain('P00   INFO: stanza-create command end: completed successfully');
    expect(output).toContain('P00   INFO: check command end: completed successfully');
  });

  it.each([
    { first: 'stanza 0', summary: 'stanza 0\nbackup 20261129-033001F full 4123456\n' },
    { first: 'stanza 2', summary: 'stanza 2\n' },
  ])(
    'OPS-001: con «$first» non esegue stanza-create, esegue check e scrive il file indicatore',
    ({ first, summary }) => {
      summaryAnswers(summary);
      const run = runInit();
      expect(run.status).toBe(0);
      expect(own(run.stdout)).toEqual([infoLine(first), CHECK, WRITTEN]);
      // Del riassunto solo la prima riga, dentro la riga info: le righe backup non si stampano.
      expectOnlyOwnOrPassedLines(run);
      expect(run.summaryCalls).toEqual([[]]);
      expect(run.pgbackrestCalls).toHaveLength(1);
      expectCommand(run.pgbackrestCalls[0], 'check', ['--archive-timeout=300']);
      expectIndicatorWritten();
    },
  );

  it.each([
    { first: 'stanza 99 [ProtocolError]', summary: 'stanza 99 [ProtocolError]\n' },
    { first: 'stanza 99', summary: 'stanza 99\n' },
    { first: 'stanza 3', summary: 'stanza 3\n' },
    { first: 'stanza 5', summary: 'stanza 5\nbackup 20261129-033001F full 4123456\n' },
  ])(
    'OPS-001: con «$first» termina con 1 e la riga d’errore, senza stanza-create, check né file indicatore',
    ({ first, summary }) => {
      summaryAnswers(summary);
      const run = runInit();
      expect(run.status).toBe(1);
      expect(own(run.stdout)).toEqual([infoLine(first)]);
      expect(own(run.stderr)).toEqual([errorLine(first)]);
      expectOnlyOwnOrPassedLines(run);
      expect(run.summaryCalls).toEqual([[]]);
      expect(run.pgbackrestCalls).toEqual([]);
      expectNoIndicator();
    },
  );

  it.each([
    { code: 2, stderr: 'pgbackrest-summary: PGBACKREST_REPO1_S3_KEY: manca o è vuota\n' },
    { code: 1, stderr: 'pgbackrest-summary: pgbackrest info terminato con codice 37\n' },
  ])(
    'OPS-001: se pgbackrest-summary termina con $code: la riga d’errore con il codice, uscita 1, pgbackrest non eseguito, nessun file indicatore',
    ({ code, stderr }) => {
      summaryAnswers('', code, stderr);
      const run = runInit();
      expect(run.status).toBe(1);
      expect(own(run.stderr)).toEqual([errorLine(`pgbackrest-summary terminato con codice ${code}`)]);
      expect(own(run.stdout)).toEqual([]);
      expectOnlyOwnOrPassedLines(run, stderr);
      expect(run.summaryCalls).toEqual([[]]);
      expect(run.pgbackrestCalls).toEqual([]);
      expectNoIndicator();
    },
  );

  it.each([
    '',
    'stanza\n',
    'stanza zero\n',
    'stanza 0 extra\n',
    'Stanza 0\n',
    'backup 20261129-033001F full 4123456\nstanza 0\n',
  ])(
    'OPS-001: con un riassunto non riconosciuto (%j) termina con 1, senza eseguire pgbackrest né scrivere il file indicatore',
    (summary) => {
      summaryAnswers(summary);
      const run = runInit();
      expect(run.status).toBe(1);
      expect(own(run.stderr)).toEqual([errorLine('risposta di pgbackrest-summary non riconosciuta')]);
      // La riga info può esserci o no; nessun passo dopo.
      expect(own(run.stdout).filter((line) => !line.startsWith('pgbackrest-init: info:'))).toEqual([]);
      expectOnlyOwnOrPassedLines(run);
      expect(run.pgbackrestCalls).toEqual([]);
      expectNoIndicator();
    },
  );

  it('OPS-001: se stanza-create fallisce termina con 1 e la riga d’errore con il codice, senza check né file indicatore', () => {
    summaryAnswers('stanza 1\n');
    pgbackrestExits('stanza-create', 28);
    const run = runInit();
    expect(run.status).toBe(1);
    expect(own(run.stdout)).toEqual([infoLine('stanza 1'), STANZA_CREATE]);
    expect(own(run.stderr)).toEqual([errorLine('stanza-create terminato con codice 28')]);
    expectOnlyOwnOrPassedLines(run);
    expect(run.pgbackrestCalls).toHaveLength(1);
    expectCommand(run.pgbackrestCalls[0], 'stanza-create');
    expectNoIndicator();
  });

  it.each([
    { first: 'stanza 1', steps: [STANZA_CREATE, CHECK] },
    { first: 'stanza 0', steps: [CHECK] },
  ])(
    'OPS-001: con «$first», se check fallisce termina con 1 e la riga d’errore con il codice, senza file indicatore',
    ({ first, steps }) => {
      summaryAnswers(`${first}\n`);
      pgbackrestExits('check', 82);
      const run = runInit();
      expect(run.status).toBe(1);
      expect(own(run.stdout)).toEqual([infoLine(first), ...steps]);
      expect(own(run.stderr)).toEqual([errorLine('check terminato con codice 82')]);
      expectOnlyOwnOrPassedLines(run);
      expect(run.pgbackrestCalls).toHaveLength(steps.length);
      expectCommand(run.pgbackrestCalls.at(-1), 'check', ['--archive-timeout=300']);
      expectNoIndicator();
    },
  );

  it('OPS-001: se il file indicatore non si può scrivere termina con 1 e una riga «pgbackrest-init: errore:»', () => {
    summaryAnswers('stanza 0\n');
    // La «cartella» del file indicatore è un file normale: né il file temporaneo né l'indicatore si possono creare.
    writeFileSync(join(root, 'non-una-cartella'), '');
    const run = runInit([join(root, 'non-una-cartella', '.pgbackrest-stanza-ok')]);
    expect(run.status).toBe(1);
    expect(
      linesOf(run.stderr).some((line) => line.startsWith('pgbackrest-init: errore:')),
      run.stderr,
    ).toBe(true);
    expect(own(run.stdout)).not.toContain(WRITTEN);
  });

  it('OPS-001: due esecuzioni di seguito: la seconda non esegue niente e stampa solo la riga del file indicatore; tolto il file, la successiva rifà il riassunto e check e lo riscrive', () => {
    summaryAnswers('stanza 1\n');
    const first = runInit();
    expect(first.status).toBe(0);
    expect(first.summaryCalls).toHaveLength(1);
    expect(first.pgbackrestCalls).toHaveLength(2);
    expectIndicatorWritten();

    const second = runInit();
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(`${INDICATOR_PRESENT}\n`);
    expect(second.summaryCalls).toEqual([]);
    expect(second.pgbackrestCalls).toEqual([]);
    expectIndicatorWritten();

    rmSync(indicator);
    summaryAnswers('stanza 2\n');
    const third = runInit();
    expect(third.status).toBe(0);
    expect(own(third.stdout)).toEqual([infoLine('stanza 2'), CHECK, WRITTEN]);
    expectOnlyOwnOrPassedLines(third);
    expect(third.summaryCalls).toEqual([[]]);
    expect(third.pgbackrestCalls).toHaveLength(1);
    expectCommand(third.pgbackrestCalls[0], 'check', ['--archive-timeout=300']);
    expectIndicatorWritten();
  });
});
