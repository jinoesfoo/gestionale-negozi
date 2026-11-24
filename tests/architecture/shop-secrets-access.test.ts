import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// 00 R-DATI-10 e 02 NEG-014 (NEG-T09, nota (6) del piano): i segreti di un negozio si leggono e si scrivono solo con
// src/server/secrets/shop-secrets.ts, dentro withShop. Il rilevatore legge i sorgenti di src/ con il compilatore
// TypeScript, come session-state.test.ts, e segnala:
// - gli identificatori `shopSecrets` (la tabella di Drizzle) e `createShopSecrets` (la fabbrica che serve solo ai test);
// - la parola `shop_secrets`, intera e senza distinguere maiuscole e minuscole, in un letterale o in un modello (i
//   commenti non contano; `SHOP_SECRETS_KEY` non è la parola intera).
// Sono ammessi solo l'helper, il file della tabella, src/server/db/isolation/ (fixture ed elenco consentito) e
// src/server/exports/redact.ts. Nelle migrazioni guarda i corpi delle funzioni (il testo fra i delimitatori `$…$`):
// nessuna funzione nomina la tabella (purge_shop la trova dal catalogo), perché una funzione SECURITY DEFINER la
// leggerebbe per tutti i negozi, senza la RLS e senza l'helper. Il compito che scriverà `secrets:rotate-shop-key`
// aggiunge il proprio file ai file ammessi.

const root = join(import.meta.dirname, '..', '..');
const SOURCE_FILES = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const PLACEHOLDER = '${…}';

const HELPER = 'src/server/secrets/shop-secrets.ts';
const TABLE_SCHEMA = 'src/server/db/schema/shop-secrets.ts';
const ALLOWED_FILES = new Set([HELPER, TABLE_SCHEMA, 'src/server/exports/redact.ts']);
const ALLOWED_FOLDERS = ['src/server/db/isolation/'];

const TABLE_WORD = /(?<![\w$])shop_secrets(?![\w$])/i;
const IDENTIFIERS = new Set(['shopSecrets', 'createShopSecrets']);

interface Occurrence {
  file: string;
  what: string;
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Le occorrenze della tabella in un sorgente: funzione pura sul testo di un file (i commenti non contano). */
function scanSource(file: string, source: string): Occurrence[] {
  const found: Occurrence[] = [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && IDENTIFIERS.has(node.text)) {
      found.push({ file, what: `identificatore ${node.text}` });
    } else if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map((span) => PLACEHOLDER + span.literal.text).join('');
      if (TABLE_WORD.test(text)) found.push({ file, what: 'shop_secrets in un modello' });
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && TABLE_WORD.test(node.text)) {
      found.push({ file, what: 'shop_secrets in un letterale' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * I corpi delle funzioni di un file SQL: il testo fra i delimitatori `$…$`, anche con un'etichetta (`$body$`, `$q1$`:
 * per PostgreSQL l'etichetta comincia con una lettera o `_` e può contenere cifre).
 */
function functionBodies(sqlText: string): string[] {
  return [...sqlText.matchAll(/\$((?:[A-Za-z_][A-Za-z0-9_]*)?)\$([\s\S]*?)\$\1\$/g)].map((match) => match[2]!);
}

/** Le occorrenze della tabella nei corpi delle funzioni di una migrazione. */
function scanMigration(file: string, sqlText: string): Occurrence[] {
  return functionBodies(sqlText)
    .filter((body) => TABLE_WORD.test(body))
    .map(() => ({ file, what: 'shop_secrets nel corpo di una funzione' }));
}

const allowed = (file: string) => ALLOWED_FILES.has(file) || ALLOWED_FOLDERS.some((folder) => file.startsWith(folder));

/**
 * Le violazioni: le occorrenze fuori dai file ammessi; `createShopSecrets`, che serve solo ai test, è ammessa solo
 * nell'helper che la definisce (nota (4)(b)); nelle migrazioni nessuna occorrenza è ammessa.
 */
function violations(occurrences: Occurrence[]): string[] {
  return occurrences
    .filter((occurrence) => {
      if (!occurrence.file.startsWith('src/')) return true;
      if (occurrence.what === 'identificatore createShopSecrets') return occurrence.file !== HELPER;
      return !allowed(occurrence.file);
    })
    .map((occurrence) => `${occurrence.file}: ${occurrence.what}`);
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
  it('NEG-014: segnala la tabella in un letterale o in un modello, senza distinguere maiuscole e minuscole, e gli identificatori shopSecrets e createShopSecrets', () => {
    const rejected = [
      'const q = sql`DELETE FROM SHOP_SECRETS WHERE shop_id = ${shopId}`;',
      "const q = 'SELECT ciphertext FROM public.shop_secrets';",
      'const q = `select * from "shop_secrets"`;',
      "import { shopSecrets } from '@/server/db/schema';",
      'const rows = await tx.select().from(schema.shopSecrets);',
      'const rows = await tx.query.shopSecrets.findMany();',
      "import { createShopSecrets } from '@/server/secrets/shop-secrets';",
    ];
    for (const source of rejected) {
      expect(violations(scanSource('src/server/altro.ts', source)), source).not.toEqual([]);
    }
  });

  it('NEG-014: ammette l’helper importato altrove, SHOP_SECRETS_KEY, altre parole che contengono il nome e i commenti', () => {
    const accepted = [
      "import { getShopSecret, setShopSecret } from '@/server/secrets/shop-secrets';",
      "const name = 'SHOP_SECRETS_KEY';",
      'const key = env.SHOP_SECRETS_KEY;',
      "const t = 'shop_secrets_archive';",
      '// SELECT ciphertext FROM shop_secrets\nexport const x = 1;',
      '/* DELETE FROM shop_secrets */ export const y = 2;',
    ];
    for (const source of accepted) {
      expect(scanSource('src/server/altro.ts', source), source).toEqual([]);
    }
  });

  it('NEG-014: nei file ammessi le occorrenze non sono violazioni', () => {
    const source =
      "import { shopSecrets } from '@/server/db/schema';\nconst q = sql`SELECT ciphertext FROM public.shop_secrets`;";
    for (const file of [HELPER, TABLE_SCHEMA, 'src/server/exports/redact.ts', 'src/server/db/isolation/fixtures.ts']) {
      expect(scanSource(file, source)).not.toEqual([]);
      expect(violations(scanSource(file, source)), file).toEqual([]);
    }
  });

  it('NEG-014: createShopSecrets è ammessa solo nell’helper che la definisce, non negli altri file ammessi', () => {
    const source = "import { createShopSecrets } from '@/server/secrets/shop-secrets';";
    for (const file of [TABLE_SCHEMA, 'src/server/exports/redact.ts', 'src/server/db/isolation/fixtures.ts']) {
      expect(violations(scanSource(file, source)), file).not.toEqual([]);
    }
    const definition = 'export function createShopSecrets() { return {}; }';
    expect(scanSource(HELPER, definition)).not.toEqual([]);
    expect(violations(scanSource(HELPER, definition))).toEqual([]);
  });

  it('NEG-014: nelle migrazioni segnala la tabella nel corpo di una funzione, non nelle istruzioni fuori dai corpi', () => {
    const rejected = [
      'CREATE FUNCTION public.f() RETURNS bytea LANGUAGE sql SECURITY DEFINER AS $$ SELECT ciphertext FROM public.shop_secrets LIMIT 1 $$;',
      'CREATE FUNCTION public.g() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN DELETE FROM Shop_Secrets; END $body$;',
      'CREATE FUNCTION public.h() RETURNS bigint LANGUAGE sql AS $q1$ SELECT count(*) FROM public.shop_secrets $q1$;',
    ];
    for (const sqlText of rejected) {
      expect(violations(scanMigration('drizzle/0000_prova.sql', sqlText)), sqlText).not.toEqual([]);
    }
    const accepted =
      'CREATE TABLE "shop_secrets" ("id" uuid PRIMARY KEY);\n--> statement-breakpoint\n' +
      'ALTER TABLE public.shop_secrets ENABLE ROW LEVEL SECURITY;\n--> statement-breakpoint\n' +
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;';
    expect(scanMigration('drizzle/0000_prova.sql', accepted)).toEqual([]);
    expect(functionBodies(accepted)).toHaveLength(1);
  });
});

describe('sorgenti e migrazioni', () => {
  it('NEG-014: solo src/server/secrets/shop-secrets.ts, il file della tabella, le fixture con l’elenco consentito e redact.ts nominano shop_secrets, e nessuna funzione delle migrazioni', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const occurrences = files.flatMap((file) => scanSource(file, readFileSync(join(root, file), 'utf8')));

    // Controllo positivo: la scansione trova la tabella nel suo file e nell'helper (i due file che la usano davvero).
    const filesWithTable = new Set(occurrences.map((occurrence) => occurrence.file));
    expect(filesWithTable).toContain(TABLE_SCHEMA);
    expect(filesWithTable).toContain(HELPER);

    const migrations = migrationFiles();
    // Controllo positivo: il rilevatore trova i corpi delle funzioni delle migrazioni (resolve_host compresa).
    const bodies = migrations.flatMap((file) => functionBodies(readFileSync(join(root, file), 'utf8')));
    expect(bodies.some((body) => body.includes('FROM public.shops AS s'))).toBe(true);
    occurrences.push(...migrations.flatMap((file) => scanMigration(file, readFileSync(join(root, file), 'utf8'))));

    expect(violations(occurrences)).toEqual([]);
  });
});
