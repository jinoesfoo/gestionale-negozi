import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// I timer systemd dei backup notturni (08 OPS-002 e OPS-003; 08 §pgBackRest, «Pianificazione con timer systemd
// dell'host», e OPS-T01a, note del piano «Timer», «`backup.sh`» (b) e «Prove»): infra/systemd/backup@.service,
// backup-full.timer e backup-diff.timer, letti come testo, e i calendari dei due timer calcolati da
// `systemd-analyze calendar` del computer (c'è su tutte e due le postazioni e in CI), con TZ=UTC, attorno ai due cambi
// dell'ora del 2027. Le 3:30 stanno fuori dall'ora che manca o si ripete, e il fuso sta nell'espressione
// (`… Europe/Rome`), quindi i timer non dipendono dal fuso dei server. Ogni controllo dei file è una funzione che
// restituisce i problemi (nessuno se il file rispetta la specifica): i test sui file del repository vogliono l'elenco
// vuoto, quelli «del controllo» provano la stessa funzione su varianti scritte qui, e quelli «dello strumento» provano
// systemd-analyze e la lettura della sua uscita con i calendari della specifica. L'installazione per l'utente deploy
// sui due server sta nella lista di controllo docs/verifiche/ops-t01a.md (E8-E10).

const ROOT = new URL('../../../', import.meta.url);
const SERVICE = 'infra/systemd/backup@.service';

/** Un timer della specifica (08, note del piano di OPS-T01a, «Timer»). */
interface TimerSpec {
  file: string;
  calendar: string;
  unit: string;
  /** true: scatta solo la domenica (completo); false: mai la domenica (differenziale). */
  sundays: boolean;
}

const FULL: TimerSpec = {
  file: 'infra/systemd/backup-full.timer',
  calendar: 'Sun *-*-* 03:30:00 Europe/Rome',
  unit: 'backup@full.service',
  sundays: true,
};
const DIFF: TimerSpec = {
  file: 'infra/systemd/backup-diff.timer',
  calendar: 'Mon..Sat *-*-* 03:30:00 Europe/Rome',
  unit: 'backup@diff.service',
  sundays: false,
};
const TIMERS: [string, TimerSpec][] = [
  [FULL.file, FULL],
  [DIFF.file, DIFF],
];

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

// --- File di unità ---------------------------------------------------------------------------------------------------

/** Un file di unità: sezione → chiave → valori nell'ordine del file (systemd ammette chiavi ripetute). */
type Unit = Map<string, Map<string, string[]>>;

/**
 * Le sezioni e le chiavi di un file di unità, come le legge systemd (systemd.syntax(7)): una riga che finisce con `\`
 * continua nella successiva, le righe vuote e quelle che cominciano con `#` o `;` non contano, gli spazi ai lati di
 * `=` nemmeno. Le righe fuori da una sezione o senza `=` finiscono nella sezione «» con la chiave «».
 */
function parseUnit(text: string): Unit {
  const unit: Unit = new Map();
  const add = (section: string, key: string, value: string) => {
    const keys = unit.get(section) ?? new Map<string, string[]>();
    keys.set(key, [...(keys.get(key) ?? []), value]);
    unit.set(section, keys);
  };
  let section = '';
  let pending = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#') || line.startsWith(';')) continue;
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1)} `;
      continue;
    }
    const full = `${pending}${line}`.trim();
    pending = '';
    if (full === '') continue;
    const header = /^\[([^\]]+)\]$/.exec(full);
    if (header?.[1] !== undefined) {
      section = header[1];
      if (!unit.has(section)) unit.set(section, new Map());
      continue;
    }
    const equals = full.indexOf('=');
    if (section === '' || equals <= 0) add('', '', full);
    else add(section, full.slice(0, equals).trim(), full.slice(equals + 1).trim());
  }
  if (pending.trim() !== '') add('', '', pending.trim());
  return unit;
}

function readUnit(path: string): Unit {
  return parseUnit(read(path));
}

/** La chiave c'è una volta sola, con il valore atteso (o con un valore qualsiasi non vuoto). */
function keyProblems(unit: Unit, section: string, key: string, expected?: string): string[] {
  const found = unit.get(section)?.get(key) ?? [];
  const ok = found.length === 1 && (expected === undefined ? found[0] !== '' : found[0] === expected);
  return ok ? [] : [`[${section}] ${key}: atteso ${expected ?? 'un valore'}, trovati ${JSON.stringify(found)}`];
}

function malformedProblems(unit: Unit): string[] {
  const lines = unit.get('')?.get('') ?? [];
  return lines.length === 0 ? [] : [`righe fuori da una sezione o senza «=»: ${JSON.stringify(lines)}`];
}

/** backup@.service avvia backup.sh con il tipo dell'istanza (full o diff), una volta, solo dai timer. */
function serviceStartProblems(unit: Unit): string[] {
  return [
    ...malformedProblems(unit),
    ...keyProblems(unit, 'Unit', 'Description'),
    ...keyProblems(unit, 'Service', 'Type', 'oneshot'),
    ...keyProblems(unit, 'Service', 'ExecStart', '/usr/bin/bash /srv/app/infra/scripts/backup.sh %i'),
    ...(unit.has('Install') ? ['[Install] non previsto: il servizio lo avviano solo i due timer'] : []),
  ];
}

/** Il limite del servizio sta sopra le 5h30m del `timeout` dentro il container (nota «`backup.sh`» (b)). */
function serviceTimeoutProblems(unit: Unit): string[] {
  return keyProblems(unit, 'Service', 'TimeoutStartSec', '6h');
}

function timerProblems(unit: Unit, spec: TimerSpec): string[] {
  const delayed = [...unit].filter(([, keys]) => keys.has('RandomizedDelaySec')).map(([name]) => `[${name}]`);
  return [
    ...malformedProblems(unit),
    ...keyProblems(unit, 'Unit', 'Description'),
    ...keyProblems(unit, 'Timer', 'OnCalendar', spec.calendar),
    ...keyProblems(unit, 'Timer', 'Unit', spec.unit),
    ...keyProblems(unit, 'Timer', 'Persistent', 'false'),
    ...keyProblems(unit, 'Install', 'WantedBy', 'timers.target'),
    ...(delayed.length > 0 ? [`RandomizedDelaySec non previsto: ${delayed.join(', ')}`] : []),
  ];
}

/** Il calendario scritto nel file del timer: una sola riga OnCalendar in [Timer]. */
function fileCalendar(spec: TimerSpec): string {
  const found = readUnit(spec.file).get('Timer')?.get('OnCalendar') ?? [];
  expect(found, `${spec.file}: una sola riga OnCalendar in [Timer]`).toHaveLength(1);
  return found[0] ?? '';
}

const SAMPLE_SERVICE = [
  '[Unit]',
  'Description=Backup di PostgreSQL con pgBackRest (%i)',
  '',
  '[Service]',
  'Type=oneshot',
  'ExecStart=/usr/bin/bash /srv/app/infra/scripts/backup.sh %i',
  'TimeoutStartSec=6h',
  '',
].join('\n');

const SERVICE_ACCEPTED: Accepted[] = [
  ['il servizio di prova così com’è', []],
  [
    'commenti (# e ;), spazi attorno a = e una chiave in più',
    [
      ['[Service]\n', '[Service]\n# Un backup alla volta.\n; altro commento\nWorkingDirectory=/srv/app\n'],
      ['Type=oneshot', 'Type = oneshot'],
    ],
  ],
];

const SERVICE_REJECTED: Rejected[] = [
  [
    'una sezione [Install]',
    [['TimeoutStartSec=6h\n', 'TimeoutStartSec=6h\n\n[Install]\nWantedBy=default.target\n']],
    '[Install] non previsto',
  ],
  ['TimeoutStartSec=5h', [['TimeoutStartSec=6h', 'TimeoutStartSec=5h']], '[Service] TimeoutStartSec: atteso 6h'],
  ['senza TimeoutStartSec', [['TimeoutStartSec=6h\n', '']], '[Service] TimeoutStartSec: atteso 6h, trovati []'],
  ['Type=simple', [['Type=oneshot', 'Type=simple']], '[Service] Type: atteso oneshot'],
  ['ExecStart con /bin/bash', [['ExecStart=/usr/bin/bash', 'ExecStart=/bin/bash']], '[Service] ExecStart:'],
  ['ExecStart con il tipo fisso al posto di %i', [['backup.sh %i', 'backup.sh full']], '[Service] ExecStart:'],
  ['due ExecStart', [['TimeoutStartSec=6h', 'ExecStart=/usr/bin/true\nTimeoutStartSec=6h']], '[Service] ExecStart:'],
  ['senza Description', [['Description=', 'Documentation=']], '[Unit] Description:'],
  ['una riga senza =', [['Type=oneshot', 'Type=oneshot\noneshot']], 'righe fuori da una sezione o senza «=»'],
];

function sampleTimer(spec: TimerSpec): string {
  return [
    '[Unit]',
    `Description=Backup di prova (${spec.unit})`,
    '',
    '[Timer]',
    `OnCalendar=${spec.calendar}`,
    `Unit=${spec.unit}`,
    'Persistent=false',
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
}

const TIMER_ACCEPTED: Accepted[] = [
  ['il timer di prova così com’è', []],
  [
    'commenti, spazi attorno a = e una chiave in più (AccuracySec)',
    [
      ['[Timer]\n', '[Timer]\n# Di notte, ora di Roma.\nAccuracySec=1min\n'],
      ['Persistent=false', 'Persistent = false'],
    ],
  ],
];

const TIMER_REJECTED: Rejected[] = [
  [
    'RandomizedDelaySec=15min',
    [['Persistent=false', 'Persistent=false\nRandomizedDelaySec=15min']],
    'RandomizedDelaySec non previsto: [Timer]',
  ],
  ['Persistent=true', [['Persistent=false', 'Persistent=true']], '[Timer] Persistent: atteso false'],
  ['Persistent=no', [['Persistent=false', 'Persistent=no']], '[Timer] Persistent: atteso false'],
  ['senza Persistent', [['Persistent=false\n', '']], '[Timer] Persistent: atteso false, trovati []'],
  ['OnCalendar senza Europe/Rome', [[' Europe/Rome', '']], '[Timer] OnCalendar:'],
  ['due OnCalendar', [['Persistent=false', 'OnCalendar=*-*-* 12:00:00\nPersistent=false']], '[Timer] OnCalendar:'],
  ['Unit di un altro servizio', [['Unit=backup@', 'Unit=altro@']], '[Timer] Unit:'],
  ['senza [Install]', [['\n[Install]\nWantedBy=timers.target\n', '\n']], '[Install] WantedBy: atteso timers.target'],
  ['WantedBy=default.target', [['WantedBy=timers.target', 'WantedBy=default.target']], '[Install] WantedBy:'],
  ['senza Description', [['Description=', 'Documentation=']], '[Unit] Description:'],
];

// --- Calendari -------------------------------------------------------------------------------------------------------

/** L'ambiente di systemd-analyze: solo PATH, il fuso UTC e la lingua C (date in inglese, «Next elapse»). */
const ANALYZE_ENV: Record<string, string> = { PATH: '/usr/bin:/bin', TZ: 'UTC', LC_ALL: 'C' };

/** Le prossime `iterations` scadenze di un calendario dopo `base`, come le scrive systemd-analyze (in UTC). */
function elapses(calendar: string, base: string, iterations: number): string[] {
  const result = spawnSync(
    'systemd-analyze',
    ['calendar', `--iterations=${iterations}`, `--base-time=${base}`, calendar],
    // I tipi di Next.js vogliono NODE_ENV in ProcessEnv: qui l'ambiente ha solo le variabili date.
    { env: ANALYZE_ENV as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 15_000 },
  );
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'systemd-analyze non trovato in /usr/bin né in /bin: serve per provare i calendari dei timer (OPS-002). ' +
          'Su Debian e Ubuntu è nel pacchetto systemd.',
      );
    }
    throw result.error;
  }
  expect(result.status, `systemd-analyze calendar '${calendar}': ${result.stderr}`).toBe(0);
  return result.stdout.split('\n').flatMap((line) => {
    const match = /^\s*(?:Next elapse|Iteration #\d+):\s+(.*\S)\s*$/.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Un istante scritto da systemd-analyze («Sun 2027-03-28 01:30:00 UTC»), in millisecondi. */
function parseElapse(text: string): number {
  const match = /^([A-Z][a-z]{2}) (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC$/.exec(text);
  if (match === null) throw new Error(`istante non riconosciuto: ${text}`);
  const [year, month, day, hour, minute, second] = match.slice(2).map(Number);
  const ms = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0);
  expect(WEEKDAYS[new Date(ms).getUTCDay()], `giorno della settimana di ${text}`).toBe(match[1]);
  return ms;
}

const ROME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Data (AAAA-MM-GG) e ora (HH:MM) di Roma di un istante. */
function inRome(ms: number): { date: string; time: string } {
  const parts = new Map(ROME.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? '?';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

/** Le date di Roma delle prime `count` notti, dopo il giorno di `base`, in cui il timer deve scattare. */
function expectedNights(base: string, sundays: boolean, count: number): string[] {
  const start = inRome(Date.parse(base.replace(' ', 'T').replace(' UTC', 'Z'))).date;
  const [year, month, day] = start.split('-').map(Number);
  const nights: string[] = [];
  for (let offset = 1; nights.length < count; offset += 1) {
    const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offset));
    if ((date.getUTCDay() === 0) === sundays) nights.push(date.toISOString().slice(0, 10));
  }
  return nights;
}

/** Le scadenze dopo un istante di partenza (08, note del piano di OPS-T01a, «Prove»: le domeniche del cambio d'ora). */
interface CalendarCase {
  spec: TimerSpec;
  base: string;
  note: string;
  elapses: string[];
}

const CALENDAR_CASES: CalendarCase[] = [
  {
    spec: FULL,
    base: '2027-03-27 12:00:00 UTC',
    note: 'la domenica del passaggio all’ora legale (28/03/2027) e la successiva',
    elapses: ['Sun 2027-03-28 01:30:00 UTC', 'Sun 2027-04-04 01:30:00 UTC'],
  },
  {
    spec: FULL,
    base: '2027-10-30 12:00:00 UTC',
    note: 'la domenica del ritorno all’ora solare (31/10/2027) e la successiva',
    elapses: ['Sun 2027-10-31 02:30:00 UTC', 'Sun 2027-11-07 02:30:00 UTC'],
  },
  {
    spec: FULL,
    base: '2027-12-24 12:00:00 UTC',
    note: 'la domenica dopo un venerdì d’inverno',
    elapses: ['Sun 2027-12-26 02:30:00 UTC'],
  },
  {
    spec: DIFF,
    base: '2027-10-29 12:00:00 UTC',
    note: 'il sabato prima del ritorno all’ora solare, poi il lunedì',
    elapses: ['Sat 2027-10-30 01:30:00 UTC', 'Mon 2027-11-01 02:30:00 UTC'],
  },
  {
    spec: DIFF,
    base: '2027-03-27 12:00:00 UTC',
    note: 'la domenica del passaggio all’ora legale saltata: lunedì e martedì',
    elapses: ['Mon 2027-03-29 01:30:00 UTC', 'Tue 2027-03-30 01:30:00 UTC'],
  },
];

/** Due partenze che attraversano i cambi d'ora: marzo (ora legale) e ottobre (ora solare) 2027. */
const WEEK_BASES = ['2027-03-20 12:00:00 UTC', '2027-10-20 12:00:00 UTC'];
const NIGHTS = 14;
const WEEK_CASES: [string, TimerSpec, string][] = [FULL, DIFF].flatMap((spec) =>
  WEEK_BASES.map((base): [string, TimerSpec, string] => [`${spec.file} dal ${base}`, spec, base]),
);

/** Le prime 14 scadenze: tutte alle 3:30 di Roma, nelle notti giuste, senza notti saltate né in più. */
function checkNights(calendar: string, spec: TimerSpec, base: string): void {
  const actual = elapses(calendar, base, NIGHTS).map((text) => inRome(parseElapse(text)));
  expect(actual).toEqual(expectedNights(base, spec.sundays, NIGHTS).map((date) => ({ date, time: '03:30' })));
}

// --- Test ------------------------------------------------------------------------------------------------------------

describe('servizio dei backup (infra/systemd/backup@.service)', () => {
  it('OPS-002: servizio oneshot che lancia /usr/bin/bash /srv/app/infra/scripts/backup.sh %i (full o diff dal nome dell’istanza), con una Description e senza [Install] (lo avviano solo i timer)', () => {
    expect(serviceStartProblems(readUnit(SERVICE))).toEqual([]);
  });

  it('OPS-003: TimeoutStartSec=6h, oltre le 5h30m del limite dentro il container: backup.sh registra anche un backup interrotto (codice 124)', () => {
    expect(serviceTimeoutProblems(readUnit(SERVICE))).toEqual([]);
  });

  it.each(SERVICE_ACCEPTED)('OPS-002: il controllo del servizio accetta %s', (_label, changes) => {
    const unit = parseUnit(applyChanges(SAMPLE_SERVICE, changes));
    expect([...serviceStartProblems(unit), ...serviceTimeoutProblems(unit)]).toEqual([]);
  });

  it.each(SERVICE_REJECTED)('OPS-002: il controllo del servizio rifiuta %s', (_label, changes, problem) => {
    const unit = parseUnit(applyChanges(SAMPLE_SERVICE, changes));
    expectProblem([...serviceStartProblems(unit), ...serviceTimeoutProblems(unit)], problem);
  });
});

describe('timer dei backup (infra/systemd/backup-full.timer e backup-diff.timer)', () => {
  it.each(TIMERS)(
    'OPS-002: %s: OnCalendar della specifica, Unit dell’istanza giusta, Persistent=false, WantedBy=timers.target, una Description e nessun RandomizedDelaySec',
    (_file, spec) => {
      expect(timerProblems(readUnit(spec.file), spec)).toEqual([]);
    },
  );

  /** Le varianti ammesse, per ciascuno dei due timer: [file, descrizione, timer, modifiche]. */
  const accepted = [FULL, DIFF].flatMap((spec) =>
    TIMER_ACCEPTED.map(([label, changes]): [string, string, TimerSpec, Change[]] => [spec.file, label, spec, changes]),
  );
  /** Le varianti vietate, per ciascuno dei due timer: [file, descrizione, timer, modifiche, problema atteso]. */
  const rejected = [FULL, DIFF].flatMap((spec) =>
    TIMER_REJECTED.map(([label, changes, problem]): [string, string, TimerSpec, Change[], string] => [
      spec.file,
      label,
      spec,
      changes,
      problem,
    ]),
  );

  it.each(accepted)('OPS-002: il controllo di %s accetta %s', (_file, _label, spec, changes) => {
    expect(timerProblems(parseUnit(applyChanges(sampleTimer(spec), changes)), spec)).toEqual([]);
  });

  it.each(rejected)('OPS-002: il controllo di %s rifiuta %s', (_file, _label, spec, changes, problem) => {
    expectProblem(timerProblems(parseUnit(applyChanges(sampleTimer(spec), changes)), spec), problem);
  });
});

describe('calendari dei timer (systemd-analyze calendar, con TZ=UTC)', () => {
  it.each(CALENDAR_CASES.map((c): [string, string, CalendarCase] => [c.spec.file, c.note, c]))(
    'OPS-002: %s, %s: le scadenze in UTC sono quelle della specifica',
    (_file, _note, c) => {
      expect(elapses(fileCalendar(c.spec), c.base, c.elapses.length)).toEqual(c.elapses);
    },
  );

  it.each(WEEK_CASES)(
    'OPS-002: %s: 14 scadenze di fila, tutte alle 3:30 di Roma, il completo solo la domenica e il differenziale tutte le altre notti',
    (_name, spec, base) => {
      checkNights(fileCalendar(spec), spec, base);
    },
  );

  it.each(CALENDAR_CASES.map((c): [string, string, CalendarCase] => [c.spec.calendar, c.note, c]))(
    'OPS-002: (controllo dello strumento) systemd-analyze di questo computer calcola «%s», %s, come la specifica',
    (_calendar, _note, c) => {
      expect(elapses(c.spec.calendar, c.base, c.elapses.length)).toEqual(c.elapses);
    },
  );

  it.each(WEEK_CASES)(
    'OPS-002: (controllo dello strumento) %s, con il calendario della specifica: 14 notti alle 3:30 di Roma nei giorni giusti',
    (_name, spec, base) => {
      checkNights(spec.calendar, spec, base);
    },
  );
});
