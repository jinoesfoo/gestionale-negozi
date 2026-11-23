import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// 02 §withShop e NEG-T02, nota (12) del ritorno al piano: pg-pool non azzera la connessione al rilascio, quindi lo stato
// di sessione creato dentro una transazione resta sulla connessione e arriva al negozio successivo. Una tabella
// temporanea senza ON COMMIT DROP o un cursore WITH HOLD creati in withShop(A) sarebbero leggibili, senza RLS, da un
// withShop(B) sulla stessa connessione; un lock consultivo di sessione resterebbe preso. Il rilevatore vieta, come parole
// intere e senza distinguere maiuscole e minuscole, nei letterali e nei modelli di src/ (ogni modello letto intero, con
// o senza etichetta, con `${…}` al posto delle sostituzioni) e nei corpi delle funzioni di drizzle/*.sql (il testo fra i
// delimitatori `$…$`, che gira sulle connessioni del pool):
// - CREATE [GLOBAL|LOCAL] TEMP|TEMPORARY … senza ON COMMIT DROP nella stessa istruzione;
// - INTO TEMP|TEMPORARY, sempre;
// - la creazione nello schema pg_temp (`pg_temp.` in un'istruzione con CREATE o INTO), sempre: rende temporaneo
//   l'oggetto anche senza la parola TEMP (SET search_path = public, pg_temp resta ammesso);
// - WITH HOLD;
// - i lock consultivi di sessione (pg_advisory_lock, pg_try_advisory_lock e le varianti _shared).

const root = join(import.meta.dirname, '..', '..');
const SOURCE_FILES = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const PLACEHOLDER = '${…}';

const CREATE_TEMP = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP|TEMPORARY)\b/i;
const ON_COMMIT_DROP = /\bON\s+COMMIT\s+DROP\b/i;
const INTO_TEMP = /\bINTO\s+(?:TEMP|TEMPORARY)\b/i;
const CREATES = /\bCREATE\b|\bINTO\b/i;
const PG_TEMP_OBJECT = /(?<![\w$])"?pg_temp"?\s*\.\s*"?[a-z_]/i;
const WITH_HOLD = /\bWITH\s+HOLD\b/i;
const SESSION_LOCK = /(?<![\w$])"?pg_(?:try_)?advisory_lock(?:_shared)?"?\s*\(/i;

/** Le violazioni di un testo SQL, istruzione per istruzione. */
function checkSql(where: string, text: string): string[] {
  const violations: string[] = [];
  for (const statement of text.split(';')) {
    if (CREATE_TEMP.test(statement) && !ON_COMMIT_DROP.test(statement)) {
      violations.push(`${where}: tabella temporanea senza ON COMMIT DROP`);
    }
    if (INTO_TEMP.test(statement)) violations.push(`${where}: INTO TEMP`);
    if (CREATES.test(statement) && PG_TEMP_OBJECT.test(statement)) {
      violations.push(`${where}: oggetto creato nello schema pg_temp`);
    }
    if (WITH_HOLD.test(statement)) violations.push(`${where}: cursore WITH HOLD`);
    if (SESSION_LOCK.test(statement)) violations.push(`${where}: lock consultivo di sessione`);
  }
  return violations;
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Il rilevatore per i sorgenti: funzione pura sul testo di un file (i commenti non contano). */
function scanSource(file: string, source: string): string[] {
  const violations: string[] = [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map((span) => PLACEHOLDER + span.literal.text).join('');
      violations.push(...checkSql(file, text));
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      violations.push(...checkSql(file, node.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/** I corpi delle funzioni di un file SQL: il testo fra i delimitatori `$…$` (anche con un'etichetta, `$body$`). */
function functionBodies(sqlText: string): string[] {
  return [...sqlText.matchAll(/\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/g)].map((match) => match[2]!);
}

/** Il rilevatore per le migrazioni: solo i corpi delle funzioni, che girano sulle connessioni del pool. */
function scanMigration(file: string, sqlText: string): string[] {
  return functionBodies(sqlText).flatMap((body) => checkSql(file, body));
}

function sourceFiles(): string[] {
  return readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((path) => SOURCE_FILES.test(path))
    .map((path) => `src/${path.split(sep).join('/')}`)
    .sort();
}

function migrationFiles(): string[] {
  return readdirSync(join(root, 'drizzle'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => `drizzle/${name}`)
    .sort();
}

describe('rilevatore', () => {
  it('02§withShop: rifiuta tabelle temporanee senza ON COMMIT DROP, INTO TEMP, oggetti in pg_temp, WITH HOLD e lock consultivi di sessione', () => {
    const rejected = [
      'const q = sql`CREATE TEMP TABLE staging AS SELECT * FROM shops`;',
      "const q = 'create temporary table t (x int)';",
      "const q = 'CREATE GLOBAL TEMPORARY TABLE t (x int)';",
      "const q = 'CREATE LOCAL TEMP VIEW v AS SELECT 1';",
      "const q = 'CREATE OR REPLACE TEMP VIEW v AS SELECT 1';",
      'const q = `CREATE TEMP TABLE ${name} (x int)`;',
      "const q = 'CREATE TEMP TABLE a (x int) ON COMMIT DROP; CREATE TEMP TABLE b (y int)';",
      "const q = 'SELECT * INTO TEMP t FROM shops';",
      "const q = 'SELECT * INTO TEMPORARY TABLE t FROM shops';",
      "const q = 'CREATE TABLE pg_temp.t (x int)';",
      'const q = \'CREATE TABLE "pg_temp"."t" AS SELECT 1\';',
      "const q = 'SELECT 1 AS x INTO pg_temp.t';",
      "const q = 'DECLARE c CURSOR WITH HOLD FOR SELECT * FROM shops';",
      'const q = sql`SELECT pg_advisory_lock(${key})`;',
      "const q = 'SELECT pg_try_advisory_lock(1)';",
      "const q = 'SELECT pg_advisory_lock_shared(1)';",
      "const q = 'SELECT pg_try_advisory_lock_shared(1)';",
      'const q = \'SELECT "pg_advisory_lock"(1)\';',
    ];
    for (const source of rejected) {
      expect(scanSource('src/server/altro.ts', source), source).not.toEqual([]);
    }
  });

  it('02§withShop: ammette ON COMMIT DROP (anche in un modello con sostituzioni), i lock della transazione, SET LOCAL e search_path con pg_temp', () => {
    const allowed = [
      'const q = sql`CREATE TEMP TABLE staging (x int) ON COMMIT DROP`;',
      'const q = `CREATE TEMP TABLE ${name} (x int) ON COMMIT DROP`;',
      'const q = sql`SELECT pg_advisory_xact_lock(${key})`;',
      "const q = 'SELECT pg_try_advisory_xact_lock_shared(1)';",
      "const q = sql`SET LOCAL lock_timeout = '5s'`;",
      "const q = 'SET search_path = public, pg_temp';",
      "const q = 'templates, attempts e tempo non sono TEMP';",
      '// CREATE TEMP TABLE x (a int)\nexport const x = 1;',
    ];
    for (const source of allowed) {
      expect(scanSource('src/server/altro.ts', source), source).toEqual([]);
    }
  });

  it('02§withShop: nelle migrazioni guarda solo i corpi delle funzioni, con o senza etichetta del delimitatore', () => {
    const rejected = [
      'CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ CREATE TEMP TABLE x (a int) $$;',
      'CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN PERFORM pg_advisory_lock(1); END $body$;',
    ];
    for (const sqlText of rejected) {
      expect(scanMigration('drizzle/0000_prova.sql', sqlText), sqlText).not.toEqual([]);
    }
    const allowed =
      'CREATE TEMP TABLE fuori_dal_corpo (a int);\n--> statement-breakpoint\n' +
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp ' +
      'AS $$ SELECT pg_advisory_xact_lock(1)::text::int $$;';
    expect(scanMigration('drizzle/0000_prova.sql', allowed)).toEqual([]);
    expect(functionBodies(allowed)).toHaveLength(1);
  });
});

describe('sorgenti e migrazioni', () => {
  it('02§withShop: in src/ e nei corpi delle funzioni di drizzle/ non c’è stato di sessione che resterebbe sulla connessione', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) => scanSource(file, readFileSync(join(root, file), 'utf8')));

    const migrations = migrationFiles();
    // Controllo positivo: il rilevatore trova i corpi delle funzioni delle migrazioni (resolve_host compresa).
    const bodies = migrations.flatMap((file) => functionBodies(readFileSync(join(root, file), 'utf8')));
    expect(bodies.some((body) => body.includes('FROM public.shops AS s'))).toBe(true);
    violations.push(...migrations.flatMap((file) => scanMigration(file, readFileSync(join(root, file), 'utf8'))));
    expect(violations).toEqual([]);
  });
});
