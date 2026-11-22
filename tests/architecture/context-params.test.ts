import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// 02 NEG-005 e NEG-T02, nota (8)(a) del piano: il contesto del negozio si imposta solo come valore locale alla
// transazione, tramite parametro. Nei sorgenti di src/ l'unica forma ammessa è
//   sql`… set_config('app.<nome>', ${valore}, true) …`
// cioè dentro un modello con l'etichetta `sql` di Drizzle, con il valore come parametro e `true` come terzo argomento,
// e solo in src/server/db/context.ts (chi altro deve impostare un contesto passa da createDbContext). Vietati ovunque
// `SET [LOCAL|SESSION] app.…`, set_config('app.… in un letterale fuori da un modello `sql` (sql.raw, modelli senza
// etichetta, stringhe), un valore tra apici o scritto direttamente, un terzo argomento assente, false o passato come
// parametro, un nome passato come parametro. Il rilevatore legge i sorgenti con il compilatore TypeScript, così i
// commenti non contano e un modello su più righe si legge come una stringa sola.

const root = join(import.meta.dirname, '..', '..');
const CONTEXT_FILE = 'src/server/db/context.ts';
const SOURCE_FILES = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const PLACEHOLDER = '${…}';

// SET app.x, anche con LOCAL o SESSION e con il nome tra virgolette doppie.
const SET_APP = /\bSET\s+(?:LOCAL\s+|SESSION\s+)?"?app\./i;
// Ogni chiamata a set_config, qualunque sia il primo argomento (tra apici, E'…', $$…$$, un parametro).
const SET_CONFIG_ANY = /set_config\s*\(/gi;
// La sola forma che si valuta: il nome tra apici semplici, poi valore e terzo argomento.
const SET_CONFIG_CALL = /set_config\s*\(\s*'app\.([a-z_]+)'\s*,\s*([^,()]*?)\s*,\s*([^,()]*?)\s*\)/gi;

interface Scan {
  /** Ogni forma vietata trovata, con il file. */
  violations: string[];
  /** I nomi (`shop_id`, `user_id`, …) impostati nella forma ammessa. */
  allowed: string[];
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Il testo di un modello, con ogni `${…}` sostituito da un segnaposto uguale per tutti. */
function templateText(template: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text;
  return template.head.text + template.templateSpans.map((span) => PLACEHOLDER + span.literal.text).join('');
}

/** Il rilevatore: funzione pura sul testo di un file, provata qui sotto su sorgenti finti. */
function scanSource(file: string, source: string): Scan {
  const violations: string[] = [];
  const allowed: string[] = [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));

  const checkSqlTemplate = (text: string) => {
    if (SET_APP.test(text)) violations.push(`${file}: SET … app. in un modello sql`);
    const occurrences = text.match(SET_CONFIG_ANY)?.length ?? 0;
    let calls = 0;
    for (const match of text.matchAll(SET_CONFIG_CALL)) {
      calls += 1;
      const [, name, value, isLocal] = match;
      if (value !== PLACEHOLDER) {
        violations.push(`${file}: set_config('app.${name}', …) senza il valore come parametro`);
      } else if (isLocal?.toLowerCase() !== 'true') {
        violations.push(`${file}: set_config('app.${name}', …) senza true come terzo argomento`);
      } else if (file !== CONTEXT_FILE) {
        violations.push(`${file}: set_config('app.${name}', …) fuori da ${CONTEXT_FILE}`);
      } else {
        allowed.push(name!.toLowerCase());
      }
    }
    if (calls < occurrences) {
      violations.push(
        `${file}: set_config in una forma non ammessa (nome non scritto come 'app.…', nome come parametro, argomenti mancanti)`,
      );
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'sql') {
      checkSqlTemplate(templateText(node.template));
      if (ts.isTemplateExpression(node.template)) {
        for (const span of node.template.templateSpans) visit(span.expression);
      }
      return;
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (SET_APP.test(node.text)) violations.push(`${file}: SET … app. in un letterale`);
      if (/set_config\s*\(/i.test(node.text)) violations.push(`${file}: set_config fuori da un modello sql di Drizzle`);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { violations, allowed };
}

/** I file di src/ con un'estensione JavaScript o TypeScript, con il percorso dalla radice e le barre in avanti. */
function sourceFiles(): string[] {
  return readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((path) => SOURCE_FILES.test(path))
    .map((path) => `src/${path.split(sep).join('/')}`)
    .sort();
}

describe('rilevatore', () => {
  it('NEG-005: ammette solo set_config con il valore come parametro e true, in un modello sql di context.ts, anche su più righe', () => {
    const inline = scanSource(
      CONTEXT_FILE,
      "const q = sql`SELECT set_config('app.shop_id', ${shopId}, true), set_config('app.user_id', ${userId}, true)`;",
    );
    expect(inline).toEqual({ violations: [], allowed: ['shop_id', 'user_id'] });

    const multiline = scanSource(
      CONTEXT_FILE,
      "const q = sql`\n  SELECT set_config(\n    'app.shop_id',\n    ${shopId},\n    TRUE\n  )\n`;",
    );
    expect(multiline).toEqual({ violations: [], allowed: ['shop_id'] });
  });

  it('NEG-005: rifiuta le forme senza parametro, senza true, fuori da un modello sql e SET app.', () => {
    const rejected = [
      "const q = sql`SELECT set_config('app.shop_id', '${shopId}', true)`;",
      "const q = sql`SELECT set_config('app.shop_id', ${shopId}, false)`;",
      "const q = sql`SELECT set_config('app.shop_id', ${shopId})`;",
      "const q = sql`SELECT set_config('app.shop_id', ${shopId}, ${local})`;",
      "const q = sql`SELECT set_config('app.shop_id', 'abc', true)`;",
      'const q = sql`SELECT set_config(${name}, ${shopId}, true)`;',
      "const q = sql.raw(`SELECT set_config('app.shop_id', '${shopId}', true)`);",
      "await client.query(`SELECT set_config('app.shop_id', '${shopId}', true)`);",
      'await client.query("SELECT set_config(\'app.shop_id\', $1, true)", [shopId]);',
      'const q = "SET LOCAL app.shop_id = \'" + shopId + "\'";',
      'const q = sql`SET LOCAL app.shop_id = ${shopId}`;',
      "const q = 'set session app.user_id to x';",
      "const q = 'SET app.user_id = 1';",
      'const q = \'SET "app.shop_id" = 1\';',
      "const q = other`SELECT set_config('app.shop_id', ${shopId}, true)`;",
      "await client.query('SELECT set_config($1, $2, false)', ['app.shop_id', shopId]);",
      "const q = sql`SELECT set_config(E'app.shop_id', ${shopId}, true)`;",
      'const q = sql`SELECT set_config($$app.shop_id$$, ${shopId}, true)`;',
    ];
    for (const source of rejected) {
      expect(scanSource(CONTEXT_FILE, source).violations, source).not.toEqual([]);
    }
  });

  it('NEG-005: la forma ammessa fuori da src/server/db/context.ts è vietata', () => {
    const source = "const q = sql`SELECT set_config('app.shop_id', ${shopId}, true)`;";
    expect(scanSource('src/server/db/altro.ts', source).violations).toEqual([
      `src/server/db/altro.ts: set_config('app.shop_id', …) fuori da ${CONTEXT_FILE}`,
    ]);
  });

  it('NEG-005: i commenti non contano', () => {
    const source =
      "// SET LOCAL app.shop_id = 'x'\n/* set_config('app.shop_id', '${x}', false) */\nexport const x = 1;\n";
    expect(scanSource('src/server/db/altro.ts', source)).toEqual({ violations: [], allowed: [] });
  });
});

describe('sorgenti di src/', () => {
  it('NEG-005: in src/ il contesto si imposta solo con set_config parametrico e true, e solo in src/server/db/context.ts', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) => scanSource(file, readFileSync(join(root, file), 'utf8')).violations);
    expect(violations).toEqual([]);
  });

  it('NEG-005: src/server/db/context.ts imposta app.shop_id e app.user_id nella forma ammessa (controllo positivo)', () => {
    const { violations, allowed } = scanSource(CONTEXT_FILE, readFileSync(join(root, CONTEXT_FILE), 'utf8'));
    expect(violations).toEqual([]);
    expect(allowed).toEqual(expect.arrayContaining(['shop_id', 'user_id']));
  });
});
