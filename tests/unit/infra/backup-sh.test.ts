import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// infra/scripts/backup.sh full|diff, lanciato dai timer dei backup notturni (08 §pgBackRest, «Pianificazione con timer
// systemd»; 08 OPS-T01a, note del piano, «`backup.sh`»; OPS-002, OPS-003). Parla con Compose solo attraverso "$DC"
// (predefinito /srv/app/dc) e solo con quattro chiamate: `ps` per sapere se postgres è in esecuzione,
// `exec … pgbackrest-summary` per il riassunto del repository (con diff prima del backup, per il ripiego su full, e
// dopo ogni backup riuscito, per tipo e dimensione), `exec … timeout 330m pgbackrest … backup` (5 ore e 30 minuti: il
// timeout di GNU coreutils dell'immagine rifiuta «5h30m», correzione della fase codice del 26/11/2026) e
// `run --rm -T migrate node dist/cli.js ops:record-backup` per la registrazione, saltata con un avviso solo con il
// codice 64, riservato ai comandi del CLI non ancora scritti (01 FON-T06, nota 9). Qui gira con `bash` e un dc finto
// in una cartella temporanea: il dc finto scrive ogni chiamata e risponde come vuole il caso. Niente Docker, niente
// pgBackRest, niente rete; il percorso vero lo prova tests/infra/pgbackrest/run.sh (docs/verifiche/ops-t01a.md).

const BACKUP_SH = fileURLToPath(new URL('../../../infra/scripts/backup.sh', import.meta.url));

// Le quattro chiamate ammesse: ps e il riassunto esatti, il backup e la registrazione con le parti variabili.
const PS_ARGS = ['ps', '--status', 'running', '--services'];
const SUMMARY_ARGS = ['exec', '-T', '-u', 'postgres', 'postgres', 'pgbackrest-summary'];
const BACKUP_ARGS_START = ['exec', '-T', '-u', 'postgres', 'postgres', 'timeout', '330m', 'pgbackrest'];
const RECORD_ARGS_START = ['run', '--rm', '-T', 'migrate', 'node', 'dist/cli.js', 'ops:record-backup'];

// Le righe di backup.sh.
const USAGE = 'backup.sh: uso: backup.sh full|diff';
const NOT_RUNNING = 'backup.sh: il servizio postgres non è in esecuzione: backup saltato';
const FALLBACK =
  'backup.sh: nessun backup completo nel repository: eseguo un backup completo al posto del differenziale';
const RECORD_SKIPPED = 'backup.sh: avviso: ops:record-backup non ancora disponibile (codice 64): registrazione saltata';
const psErrorLine = (code: number) => `backup.sh: errore: docker compose ps terminato con codice ${code}`;
const recordErrorLine = (code: number) => `backup.sh: errore: ops:record-backup terminato con codice ${code}`;
const RECORD_ERROR_START = 'backup.sh: errore: ops:record-backup';

// Le righe riconoscibili del dc finto, per provare che le uscite di backup e registrazione arrivano al journal. Senza
// apici: stanno anche fra apici singoli nello script del dc finto.
const BACKUP_STDOUT = 'PROVA-BACKUP-STDOUT: riga di pgbackrest backup su stdout';
const BACKUP_STDERR = 'PROVA-BACKUP-STDERR: riga di pgbackrest backup su stderr';
const RECORD_STDOUT = 'PROVA-REGISTRAZIONE-STDOUT: riga di ops:record-backup su stdout';
const RECORD_STDERR = 'PROVA-REGISTRAZIONE-STDERR: riga di ops:record-backup su stderr';
const SUMMARY_STDERR = 'PROVA-RIASSUNTO-STDERR: riga di pgbackrest-summary su stderr, chiamata';
const summaryStderr = (call: number) => `${SUMMARY_STDERR} ${call}`;

/** L'uscita di `ps --status running --services` in esercizio: postgres in esecuzione con gli altri servizi. */
const RUNNING = 'caddy\npostgres\napp\nworker\n';

// Righe `backup <etichetta> <tipo> <byte nel repository>` di pgbackrest-summary, con etichette come quelle di
// pgBackRest. Le dimensioni sono scelte perché l'ultima riga non sia né la prima, né la più grande, né la più piccola.
const FULL_1 = 'backup 20261115-033001F full 4500000';
const DIFF_1 = 'backup 20261115-033001F_20261116-033002D diff 98000';
const FULL_2 = 'backup 20261122-033001F full 4123456';
const DIFF_2 = 'backup 20261122-033001F_20261123-033002D diff 120000';
const DIFF_3 = 'backup 20261122-033001F_20261124-033001D diff 130000';
const FULL_3 = 'backup 20261124-033001F full 4200000';
const INCR = 'backup 20261122-033001F_20261123-120001I incr 2000';

/** Il riassunto di pgbackrest-summary: la riga della stanza, poi una riga per backup, dal più vecchio. */
const summaryOf = (stanza: string, ...backups: string[]): string =>
  [`stanza ${stanza}`, ...backups].map((line) => `${line}\n`).join('');

// --- Chiamate nella forma dei confronti -------------------------------------------------------------------------------

/** Una chiamata al dc finto come la confrontano i test: le parti libere del contratto ridotte a una forma fissa. */
type Step = string[];

const PS_STEP: Step = ['ps'];
const SUMMARY_STEP: Step = ['riassunto'];
const backupStep = (type: 'full' | 'diff'): Step => ['backup', type];
const okRecord = (kind: 'full' | 'diff', bytes: string): Step => [
  'registrazione',
  '--kind',
  kind,
  '--ok',
  '--duration-s',
  '<n>',
  '--size-bytes',
  bytes,
];
const failedRecord = (kind: 'full' | 'diff', message: string): Step => [
  'registrazione',
  '--kind',
  kind,
  '--failed',
  '--duration-s',
  '<n>',
  '--message',
  message,
];

const sameArgs = (call: readonly string[], expected: readonly string[]): boolean =>
  call.length === expected.length && expected.every((arg, index) => call[index] === arg);
const startsWithArgs = (call: readonly string[], start: readonly string[]): boolean =>
  call.length >= start.length && start.every((arg, index) => call[index] === arg);

/**
 * Una chiamata nella forma dei confronti. `ps` e il riassunto valgono solo se esatti. Il backup vale con le opzioni in
 * qualunque ordine, purché fra `pgbackrest` e l'ultimo argomento `backup` ci siano --stanza=main,
 * --log-level-console=info e un solo tipo, --type=full o --type=diff: diventa ['backup', tipo]. Nella registrazione la
 * durata, se è un intero non negativo, diventa <n>. Ogni altra chiamata resta com'è, con un segno davanti, e fa
 * fallire il confronto mostrando gli argomenti.
 */
function stepOf(call: string[]): Step {
  if (sameArgs(call, PS_ARGS)) return PS_STEP;
  if (sameArgs(call, SUMMARY_ARGS)) return SUMMARY_STEP;
  if (startsWithArgs(call, BACKUP_ARGS_START) && call.length > BACKUP_ARGS_START.length && call.at(-1) === 'backup') {
    const options = call.slice(BACKUP_ARGS_START.length, -1);
    const values = (name: string) => [
      ...new Set(
        options.filter((option) => option.startsWith(`${name}=`)).map((option) => option.slice(name.length + 1)),
      ),
    ];
    const types = values('--type');
    const type = types[0];
    if (
      types.length === 1 &&
      (type === 'full' || type === 'diff') &&
      sameArgs(values('--stanza'), ['main']) &&
      sameArgs(values('--log-level-console'), ['info'])
    ) {
      return backupStep(type);
    }
    return ['backup fuori dal contratto', ...options];
  }
  if (startsWithArgs(call, RECORD_ARGS_START)) {
    const rest = call.slice(RECORD_ARGS_START.length);
    if (rest[3] === '--duration-s' && /^\d+$/.test(rest[4] ?? '')) rest[4] = '<n>';
    return ['registrazione', ...rest];
  }
  return ['chiamata fuori dal contratto', ...call];
}

// --- Programmi finti --------------------------------------------------------------------------------------------------

/**
 * Il dc finto: aggiunge ogni chiamata a dc-calls (argomenti chiusi da \037, chiamata chiusa da \036, così restano
 * intatti anche gli argomenti con spazi) e risponde con i file del caso che runBackup scrive nella cartella `dir`:
 * - `ps`: stampa ps.out, termina con ps.code;
 * - `exec … pgbackrest-summary`: alla chiamata n scrive su stderr una riga numerata, stampa summary-<n>.out e termina
 *   con summary-<n>.code (99 se il caso non prevede quella chiamata);
 * - `exec … backup`: una riga su stdout e una su stderr, aspetta backup.seconds secondi se il file c'è, termina con
 *   backup.code;
 * - `run …` (la registrazione): una riga su stdout e una su stderr, termina con record.code.
 */
function fakeDc(dir: string): string {
  return `#!/bin/sh
dir='${dir}'
{
  for arg in "$@"; do printf '%s\\037' "$arg"; done
  printf '\\036'
} >>"$dir/dc-calls"
last=''
for arg in "$@"; do last=$arg; done
case "$1" in
ps)
  cat "$dir/ps.out"
  exit "$(cat "$dir/ps.code")"
  ;;
exec)
  if [ "$last" = pgbackrest-summary ]; then
    n=$(($(cat "$dir/summary-count") + 1))
    echo "$n" >"$dir/summary-count"
    echo "${SUMMARY_STDERR} $n" >&2
    [ -f "$dir/summary-$n.code" ] || exit 99
    cat "$dir/summary-$n.out"
    exit "$(cat "$dir/summary-$n.code")"
  fi
  if [ "$last" = backup ]; then
    echo '${BACKUP_STDOUT}'
    echo '${BACKUP_STDERR}' >&2
    if [ -f "$dir/backup.seconds" ]; then sleep "$(cat "$dir/backup.seconds")"; fi
    exit "$(cat "$dir/backup.code")"
  fi
  ;;
run)
  echo '${RECORD_STDOUT}'
  echo '${RECORD_STDERR}' >&2
  exit "$(cat "$dir/record.code")"
  ;;
esac
echo 'dc finto: chiamata fuori dal contratto' >&2
exit 99
`;
}

/** Un docker finto nel PATH, per sicurezza: backup.sh non lo deve chiamare, perché passa sempre da "$DC". */
function fakeDocker(dir: string): string {
  return `#!/bin/sh
{
  for arg in "$@"; do printf '%s\\037' "$arg"; done
  printf '\\036'
} >>'${dir}/docker-calls'
echo 'docker finto: backup.sh chiama Compose solo attraverso DC' >&2
exit 99
`;
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

/** Le chiamate scritte da un programma finto, ognuna con i suoi argomenti; nessuna se il file non c'è. */
function readCalls(file: string): string[][] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\x1e')
    .slice(0, -1)
    .map((call) => call.split('\x1f').slice(0, -1));
}

const lines = (text: string): string[] => text.split('\n');

// --- Esecuzione -------------------------------------------------------------------------------------------------------

/** Le risposte del dc finto in un caso. */
interface Answers {
  /** Uscita e codice di `ps --status running --services` (predefiniti: RUNNING e 0). */
  ps?: { out: string; code: number };
  /** Le risposte di pgbackrest-summary, nell'ordine delle chiamate (codice predefinito 0). */
  summaries?: { out: string; code?: number }[];
  /** Il codice di uscita del backup (predefinito 0). */
  backupCode?: number;
  /** Quanti secondi dura il backup (predefinito: termina subito). */
  backupSeconds?: number;
  /** Il codice di uscita di ops:record-backup (predefinito 0). */
  recordCode?: number;
}

let root: string;
let binDir: string;
let dcPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ops-t01a-backup-sh-'));
  if (root.includes("'")) throw new Error(`la cartella temporanea ha un apice nel nome: ${root}`);
  // La cartella dei programmi finti ha uno spazio nel nome: backup.sh chiama il dc finto come "$DC", fra virgolette.
  binDir = join(root, 'bin finti');
  mkdirSync(binDir);
  dcPath = join(binDir, 'dc');
  writeExecutable(dcPath, fakeDc(root));
  writeExecutable(join(binDir, 'docker'), fakeDocker(root));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Esegue `bash infra/scripts/backup.sh <args>` con il dc finto (DC) e le risposte del caso. */
function runBackup(args: string[], answers: Answers = {}, env: Record<string, string> = { DC: dcPath }) {
  const ps = answers.ps ?? { out: RUNNING, code: 0 };
  writeFileSync(join(root, 'ps.out'), ps.out);
  writeFileSync(join(root, 'ps.code'), String(ps.code));
  writeFileSync(join(root, 'summary-count'), '0');
  (answers.summaries ?? []).forEach((summary, index) => {
    writeFileSync(join(root, `summary-${index + 1}.out`), summary.out);
    writeFileSync(join(root, `summary-${index + 1}.code`), String(summary.code ?? 0));
  });
  writeFileSync(join(root, 'backup.code'), String(answers.backupCode ?? 0));
  if (answers.backupSeconds !== undefined) writeFileSync(join(root, 'backup.seconds'), String(answers.backupSeconds));
  writeFileSync(join(root, 'record.code'), String(answers.recordCode ?? 0));
  const childEnv: Record<string, string> = { PATH: `${binDir}:/usr/bin:/bin`, TMPDIR: tmpdir(), ...env };
  const result = spawnSync('bash', [BACKUP_SH, ...args], {
    cwd: root,
    // I tipi di Next.js vogliono NODE_ENV in ProcessEnv: qui l'ambiente ha solo le variabili date.
    env: childEnv as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  expect(readCalls(join(root, 'docker-calls')), 'docker chiamato direttamente, non attraverso "$DC"').toEqual([]);
  const calls = readCalls(join(root, 'dc-calls'));
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls, steps: calls.map(stepOf) };
}

// --- Test -------------------------------------------------------------------------------------------------------------

describe('backup.sh: argomenti', () => {
  it.each<[string[]]>([
    [[]],
    [['incr']],
    [['full', 'diff']],
    [['diff', 'diff']],
    [['']],
    [['FULL']],
    [['--type=full']],
  ])('OPS-002: con gli argomenti %j termina con 2 e scrive l’uso, senza nessuna chiamata a Compose', (args) => {
    const result = runBackup(args);
    expect(result.status, result.stderr).toBe(2);
    expect(lines(result.stderr)).toContain(USAGE);
    expect(result.calls).toEqual([]);
  });
});

describe('backup.sh: il servizio postgres e /srv/app/dc', () => {
  it.each(['full', 'diff'])(
    'OPS-002: se docker compose ps termina con 3, backup.sh %s termina con 1 e scrive l’errore con il codice, senza altre chiamate',
    (type) => {
      const result = runBackup([type], { ps: { out: RUNNING, code: 3 } });
      expect(result.status, result.stderr).toBe(1);
      expect(lines(result.stderr)).toContain(psErrorLine(3));
      expect(result.steps).toEqual([PS_STEP]);
    },
  );

  it.each([
    { type: 'full', label: 'caddy e app', out: 'caddy\napp\n' },
    { type: 'diff', label: 'caddy e app', out: 'caddy\napp\n' },
    { type: 'full', label: 'niente', out: '' },
    { type: 'diff', label: 'niente', out: '' },
    {
      type: 'diff',
      label: 'postgres-exporter ma non postgres',
      out: 'caddy\npostgres-exporter\napp\n',
    },
  ])(
    'OPS-002: se ps scrive $label (postgres non in esecuzione), backup.sh $type termina con 0 e lo scrive nel journal, senza backup né registrazione',
    ({ type, out }) => {
      const result = runBackup([type], { ps: { out, code: 0 } });
      expect(result.status, result.stderr).toBe(0);
      expect(lines(result.stdout)).toContain(NOT_RUNNING);
      expect(result.steps).toEqual([PS_STEP]);
    },
  );

  it.each([
    { label: 'postgres fra gli altri servizi', out: 'caddy\napp\npostgres\nworker\n' },
    { label: 'solo postgres, senza a capo finale', out: 'postgres' },
  ])('OPS-002: se ps scrive $label il servizio è in esecuzione e il backup parte', ({ out }) => {
    const result = runBackup(['full'], { ps: { out, code: 0 }, summaries: [{ out: summaryOf('0', FULL_2) }] });
    expect(result.status, result.stderr).toBe(0);
    expect(lines(result.stdout)).not.toContain(NOT_RUNNING);
    expect(result.steps).toEqual([PS_STEP, backupStep('full'), SUMMARY_STEP, okRecord('full', '4123456')]);
  });

  it.skipIf(existsSync('/srv/app/dc'))(
    'OPS-002: senza DC chiama /srv/app/dc; dove non esiste ps fallisce: termina con 1, e l’errore di bash nomina /srv/app/dc',
    () => {
      const result = runBackup(['diff'], {}, {});
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('/srv/app/dc');
      expect(
        lines(result.stderr).some((line) =>
          /^backup\.sh: errore: docker compose ps terminato con codice [1-9]\d*$/.test(line),
        ),
        result.stderr,
      ).toBe(true);
      expect(result.calls).toEqual([]);
    },
  );
});

describe('backup.sh full', () => {
  it('OPS-002, OPS-003: ps, backup --type=full con timeout 330m nel container, riassunto, registrazione --ok con tipo e byte dell’ultima riga backup; termina con 0', () => {
    const result = runBackup(['full'], { summaries: [{ out: summaryOf('0', FULL_1, DIFF_1, FULL_2) }] });
    expect(result.status, result.stderr).toBe(0);
    expect(result.steps).toEqual([PS_STEP, backupStep('full'), SUMMARY_STEP, okRecord('full', '4123456')]);
    expect(lines(result.stdout)).not.toContain(FALLBACK);
  });

  it('OPS-002: un backup che termina con 55 si registra --failed --kind full con il codice, senza riassunto dopo; termina con 1', () => {
    const result = runBackup(['full'], { backupCode: 55, summaries: [{ out: summaryOf('0', FULL_2) }] });
    expect(result.status, result.stderr).toBe(1);
    expect(result.steps).toEqual([
      PS_STEP,
      backupStep('full'),
      failedRecord('full', 'pgbackrest backup terminato con codice 55'),
    ]);
  });

  it('OPS-002: un backup interrotto dal timeout (124) si registra --failed --kind full «interrotto dopo 5h30m»; termina con 1', () => {
    const result = runBackup(['full'], { backupCode: 124, summaries: [{ out: summaryOf('0', FULL_2) }] });
    expect(result.status, result.stderr).toBe(1);
    expect(result.steps).toEqual([
      PS_STEP,
      backupStep('full'),
      failedRecord('full', 'pgbackrest backup interrotto dopo 5h30m (codice 124)'),
    ]);
  });

  it.each([1, 2])(
    'OPS-003: se il riassunto dopo un backup riuscito termina con %i, registra --failed --kind full «backup riuscito, dimensione non letta: …»; termina con 1',
    (code) => {
      const result = runBackup(['full'], { summaries: [{ out: '', code }] });
      expect(result.status, result.stderr).toBe(1);
      expect(result.steps).toEqual([
        PS_STEP,
        backupStep('full'),
        SUMMARY_STEP,
        failedRecord('full', `backup riuscito, dimensione non letta: pgbackrest-summary terminato con codice ${code}`),
      ]);
    },
  );

  it('OPS-003: se il riassunto dopo il backup non ha righe backup, registra --failed «backup riuscito, dimensione non letta: nessun backup nel riassunto»; termina con 1', () => {
    const result = runBackup(['full'], { summaries: [{ out: summaryOf('0') }] });
    expect(result.status, result.stderr).toBe(1);
    expect(result.steps).toEqual([
      PS_STEP,
      backupStep('full'),
      SUMMARY_STEP,
      failedRecord('full', 'backup riuscito, dimensione non letta: nessun backup nel riassunto'),
    ]);
  });
});

describe('backup.sh diff', () => {
  it('OPS-002, OPS-003: con un completo nel repository (stanza 0): riassunto, backup --type=diff, riassunto, registrazione --kind diff --ok con i byte dell’ultima riga; termina con 0', () => {
    const result = runBackup(['diff'], {
      summaries: [{ out: summaryOf('0', FULL_2, DIFF_2) }, { out: summaryOf('0', FULL_2, DIFF_2, DIFF_3) }],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.steps).toEqual([PS_STEP, SUMMARY_STEP, backupStep('diff'), SUMMARY_STEP, okRecord('diff', '130000')]);
    expect(lines(result.stdout)).not.toContain(FALLBACK);
  });

  it('OPS-002: senza nessun backup (stanza 2) esegue un completo al posto del differenziale e lo scrive; termina con 0', () => {
    const result = runBackup(['diff'], { summaries: [{ out: summaryOf('2') }, { out: summaryOf('0', FULL_3) }] });
    expect(result.status, result.stderr).toBe(0);
    expect(lines(result.stdout)).toContain(FALLBACK);
    expect(result.steps).toEqual([
      PS_STEP,
      SUMMARY_STEP,
      backupStep('full'),
      SUMMARY_STEP,
      okRecord('full', '4200000'),
    ]);
  });

  it('OPS-002: con stanza 0 e solo un incrementale, senza completo (caso irrealistico che prova la regola), esegue un completo e lo scrive', () => {
    const result = runBackup(['diff'], {
      summaries: [{ out: summaryOf('0', INCR) }, { out: summaryOf('0', INCR, FULL_3) }],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(lines(result.stdout)).toContain(FALLBACK);
    expect(result.steps).toEqual([
      PS_STEP,
      SUMMARY_STEP,
      backupStep('full'),
      SUMMARY_STEP,
      okRecord('full', '4200000'),
    ]);
  });

  it('OPS-002: con stanza 2 e una riga full (caso irrealistico che prova la regola) resta un differenziale, perché decide la riga full', () => {
    const result = runBackup(['diff'], {
      summaries: [{ out: summaryOf('2', FULL_2) }, { out: summaryOf('0', FULL_2, DIFF_3) }],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(lines(result.stdout)).not.toContain(FALLBACK);
    expect(result.steps).toEqual([PS_STEP, SUMMARY_STEP, backupStep('diff'), SUMMARY_STEP, okRecord('diff', '130000')]);
  });

  it.each([
    { first: 'stanza 1', out: summaryOf('1') },
    { first: 'stanza 3', out: summaryOf('3') },
    { first: 'stanza 4', out: summaryOf('4', FULL_2, DIFF_2) },
    { first: 'stanza 5', out: summaryOf('5', FULL_2) },
    { first: 'stanza 6', out: summaryOf('6') },
    { first: 'stanza 99', out: summaryOf('99') },
    { first: 'stanza 99 [ProtocolError]', out: summaryOf('99 [ProtocolError]') },
  ])(
    'OPS-002: con il riassunto $first prima del backup registra --failed --kind diff «pgbackrest info: <prima riga>», senza backup; termina con 1',
    ({ first, out }) => {
      const result = runBackup(['diff'], { summaries: [{ out }] });
      expect(result.status, result.stderr).toBe(1);
      expect(result.steps).toEqual([PS_STEP, SUMMARY_STEP, failedRecord('diff', `pgbackrest info: ${first}`)]);
      expect(lines(result.stdout)).not.toContain(FALLBACK);
    },
  );

  it.each([1, 2])(
    'OPS-002: se pgbackrest-summary prima del backup termina con %i, registra --failed --kind diff con il codice, senza backup; termina con 1',
    (code) => {
      const result = runBackup(['diff'], { summaries: [{ out: '', code }] });
      expect(result.status, result.stderr).toBe(1);
      expect(result.steps).toEqual([
        PS_STEP,
        SUMMARY_STEP,
        failedRecord('diff', `pgbackrest-summary terminato con codice ${code}`),
      ]);
    },
  );

  it('OPS-002: un differenziale che termina con 55 si registra --failed --kind diff con il codice, senza riassunto dopo; termina con 1', () => {
    const result = runBackup(['diff'], { backupCode: 55, summaries: [{ out: summaryOf('0', FULL_2) }] });
    expect(result.status, result.stderr).toBe(1);
    expect(result.steps).toEqual([
      PS_STEP,
      SUMMARY_STEP,
      backupStep('diff'),
      failedRecord('diff', 'pgbackrest backup terminato con codice 55'),
    ]);
  });

  it('OPS-002: un differenziale interrotto dal timeout (124) si registra --failed --kind diff «interrotto dopo 5h30m»; termina con 1', () => {
    const result = runBackup(['diff'], { backupCode: 124, summaries: [{ out: summaryOf('0', FULL_2) }] });
    expect(result.status, result.stderr).toBe(1);
    expect(result.steps).toEqual([
      PS_STEP,
      SUMMARY_STEP,
      backupStep('diff'),
      failedRecord('diff', 'pgbackrest backup interrotto dopo 5h30m (codice 124)'),
    ]);
  });

  // Dopo il ripiego il tipo è full in ogni ramo che registra un fallimento, non l'argomento diff.
  it.each<{ label: string; answers: Answers; after: Step[] }>([
    {
      label: 'un backup che termina con 55',
      answers: { backupCode: 55, summaries: [{ out: summaryOf('2') }] },
      after: [failedRecord('full', 'pgbackrest backup terminato con codice 55')],
    },
    {
      label: 'un backup interrotto dal timeout (124)',
      answers: { backupCode: 124, summaries: [{ out: summaryOf('2') }] },
      after: [failedRecord('full', 'pgbackrest backup interrotto dopo 5h30m (codice 124)')],
    },
    {
      label: 'un riassunto dopo il backup che termina con 1',
      answers: { summaries: [{ out: summaryOf('2') }, { out: '', code: 1 }] },
      after: [
        SUMMARY_STEP,
        failedRecord('full', 'backup riuscito, dimensione non letta: pgbackrest-summary terminato con codice 1'),
      ],
    },
    {
      label: 'un riassunto dopo il backup senza righe backup',
      answers: { summaries: [{ out: summaryOf('2') }, { out: summaryOf('2') }] },
      after: [SUMMARY_STEP, failedRecord('full', 'backup riuscito, dimensione non letta: nessun backup nel riassunto')],
    },
  ])(
    'OPS-002, OPS-003: dopo il ripiego su full, con $label registra --failed --kind full, il tipo eseguito; termina con 1',
    ({ answers, after }) => {
      const result = runBackup(['diff'], answers);
      expect(result.status, result.stderr).toBe(1);
      expect(lines(result.stdout)).toContain(FALLBACK);
      expect(result.steps).toEqual([PS_STEP, SUMMARY_STEP, backupStep('full'), ...after]);
    },
  );

  it('OPS-003: un differenziale che pgBackRest trasforma in completo si registra --kind full, con i byte dell’ultima riga backup', () => {
    const result = runBackup(['diff'], {
      summaries: [{ out: summaryOf('0', FULL_2, DIFF_2) }, { out: summaryOf('0', FULL_2, DIFF_2, FULL_3) }],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.steps).toEqual([
      PS_STEP,
      SUMMARY_STEP,
      backupStep('diff'),
      SUMMARY_STEP,
      okRecord('full', '4200000'),
    ]);
  });

  it('OPS-003: se il riassunto dopo un differenziale riuscito termina con 2, registra --failed --kind diff «backup riuscito, dimensione non letta: …»; termina con 1', () => {
    const result = runBackup(['diff'], { summaries: [{ out: summaryOf('0', FULL_2) }, { out: '', code: 2 }] });
    expect(result.status, result.stderr).toBe(1);
    expect(result.steps).toEqual([
      PS_STEP,
      SUMMARY_STEP,
      backupStep('diff'),
      SUMMARY_STEP,
      failedRecord('diff', 'backup riuscito, dimensione non letta: pgbackrest-summary terminato con codice 2'),
    ]);
  });

  it('OPS-003: se il riassunto dopo un differenziale riuscito non ha righe backup (stanza 99 [ProtocolError]), registra --failed «… nessun backup nel riassunto»; termina con 1', () => {
    const result = runBackup(['diff'], {
      summaries: [{ out: summaryOf('0', FULL_2) }, { out: summaryOf('99 [ProtocolError]') }],
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.steps).toEqual([
      PS_STEP,
      SUMMARY_STEP,
      backupStep('diff'),
      SUMMARY_STEP,
      failedRecord('diff', 'backup riuscito, dimensione non letta: nessun backup nel riassunto'),
    ]);
  });
});

describe('backup.sh: registrazione con ops:record-backup', () => {
  // Il backup finto dura 1,2 secondi: la durata registrata, intera e misurata da prima a dopo il backup, vale almeno 1
  // (anche arrotondata per difetto) e al massimo 15, il limite di spawnSync (non un orario in secondi dal 1970).
  it.each([
    { label: 'riuscito', answers: { summaries: [{ out: summaryOf('0', FULL_2) }] }, status: 0 },
    { label: 'fallito con 55', answers: { backupCode: 55 }, status: 1 },
  ])(
    'OPS-003: --duration-s è un numero intero di secondi che comprende il backup ($label): con un backup di 1,2 secondi vale da 1 a 15',
    ({ answers, status }) => {
      const result = runBackup(['full'], { ...answers, backupSeconds: 1.2 });
      expect(result.status, result.stderr).toBe(status);
      const record = result.calls.at(-1) ?? [];
      expect(record.slice(0, RECORD_ARGS_START.length)).toEqual(RECORD_ARGS_START);
      expect(record[RECORD_ARGS_START.length + 3]).toBe('--duration-s');
      const duration = record[RECORD_ARGS_START.length + 4] ?? '';
      expect(duration).toMatch(/^\d+$/);
      expect(Number(duration)).toBeGreaterThanOrEqual(1);
      expect(Number(duration)).toBeLessThanOrEqual(15);
    },
  );

  it('OPS-003: con la registrazione riuscita (0) non scrive né l’avviso né l’errore della registrazione; termina con 0', () => {
    const result = runBackup(['full'], { summaries: [{ out: summaryOf('0', FULL_2) }] });
    expect(result.status, result.stderr).toBe(0);
    expect(lines(result.stdout)).not.toContain(RECORD_SKIPPED);
    expect(lines(result.stderr).filter((line) => line.startsWith(RECORD_ERROR_START))).toEqual([]);
  });

  it('OPS-003: se ops:record-backup termina con 64 (segnaposto di FON-T06), un backup riuscito termina con 0 e scrive l’avviso su stdout', () => {
    const result = runBackup(['full'], { recordCode: 64, summaries: [{ out: summaryOf('0', FULL_2) }] });
    expect(result.status, result.stderr).toBe(0);
    expect(lines(result.stdout)).toContain(RECORD_SKIPPED);
    expect(lines(result.stderr)).not.toContain(recordErrorLine(64));
    expect(result.steps).toEqual([PS_STEP, backupStep('full'), SUMMARY_STEP, okRecord('full', '4123456')]);
  });

  it.each([1, 2, 65])(
    'OPS-003: se ops:record-backup termina con %i, backup.sh termina con 1 e scrive l’errore con il codice su stderr',
    (code) => {
      const result = runBackup(['full'], { recordCode: code, summaries: [{ out: summaryOf('0', FULL_2) }] });
      expect(result.status, result.stderr).toBe(1);
      expect(lines(result.stderr)).toContain(recordErrorLine(code));
      expect(lines(result.stdout)).not.toContain(RECORD_SKIPPED);
      expect(result.steps).toEqual([PS_STEP, backupStep('full'), SUMMARY_STEP, okRecord('full', '4123456')]);
    },
  );

  it.each([
    { label: 'backup che termina con 55', type: 'full', answers: { backupCode: 55 } },
    { label: 'stanza 1 prima del differenziale', type: 'diff', answers: { summaries: [{ out: summaryOf('1') }] } },
    {
      label: 'riassunto dopo il backup: codice 1',
      type: 'full',
      answers: { summaries: [{ out: '', code: 1 }] },
    },
  ])(
    'OPS-003: con un backup non riuscito ($label) e la registrazione saltata (64) termina comunque con 1 e scrive l’avviso',
    ({ type, answers }) => {
      const result = runBackup([type], { ...answers, recordCode: 64 });
      expect(result.status, result.stderr).toBe(1);
      expect(lines(result.stdout)).toContain(RECORD_SKIPPED);
      expect(result.steps.at(-1)?.slice(0, 4)).toEqual(['registrazione', '--kind', type, '--failed']);
    },
  );

  it('OPS-003: con un backup fallito e la registrazione che termina con 1 termina con 1 e scrive l’errore della registrazione', () => {
    const result = runBackup(['full'], { backupCode: 55, recordCode: 1 });
    expect(result.status, result.stderr).toBe(1);
    expect(lines(result.stderr)).toContain(recordErrorLine(1));
    expect(result.steps).toEqual([
      PS_STEP,
      backupStep('full'),
      failedRecord('full', 'pgbackrest backup terminato con codice 55'),
    ]);
  });
});

describe('backup.sh: uscite nel journal del timer', () => {
  it('OPS-002: stdout e stderr di pgbackrest backup e di ops:record-backup passano a stdout e stderr di backup.sh, e passa lo stderr di pgbackrest-summary', () => {
    const result = runBackup(['diff'], {
      summaries: [{ out: summaryOf('0', FULL_2) }, { out: summaryOf('0', FULL_2, DIFF_3) }],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(lines(result.stdout)).toEqual(expect.arrayContaining([BACKUP_STDOUT, RECORD_STDOUT]));
    expect(lines(result.stderr)).toEqual(
      expect.arrayContaining([BACKUP_STDERR, RECORD_STDERR, summaryStderr(1), summaryStderr(2)]),
    );
  });

  it('OPS-002: anche con un backup fallito le sue righe e quelle della registrazione arrivano al journal', () => {
    const result = runBackup(['full'], { backupCode: 55 });
    expect(result.status, result.stderr).toBe(1);
    expect(lines(result.stdout)).toEqual(expect.arrayContaining([BACKUP_STDOUT, RECORD_STDOUT]));
    expect(lines(result.stderr)).toEqual(expect.arrayContaining([BACKUP_STDERR, RECORD_STDERR]));
  });
});
