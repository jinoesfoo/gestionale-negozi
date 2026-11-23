import { randomUUID } from 'node:crypto';
import { type SQL, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbContext, type DbContext } from '@/server/db/context';
import { DbError } from '@/server/db/errors';
import { createFixtureShop, type FixtureShop, SHOP_DATA_FIXTURES } from '@/server/db/isolation/fixtures';
import { type CatalogClient, type ColumnInfo, columnsOf, effectiveTableGrants } from '../../fixtures/catalog';
import { closeRolePools, rolePool, testDatabaseUrl } from '../../fixtures/db';

// Test di separazione (02 NEG-002, NEG-003, NEG-004; NEG-T05, note (1), (2), (6) e (7) del piano; 00 R-DATI-2 e
// R-DATI-7). Le tabelle di negozio si scoprono dal catalogo: le tabelle di public con una colonna shop_id, più shops
// (colonna chiave id). Le fixture inerti di src/server/db/isolation/fixtures.ts, le stesse di isolation-check (BIL-T09),
// creano i negozi A e B (negozio-a e negozio-b) con utenti diversi e una riga per tabella; ogni tabella senza fixture fa
// fallire. Con il contesto di A (createDbContext su una sola connessione di app_user) app_user non legge, non modifica,
// non cancella e non inserisce righe di B; senza contesto, sulla stessa connessione riusata, non legge nulla e non
// inserisce. Le istruzioni usano solo le colonne su cui app_user ha il permesso, lette dal catalogo; dove non ha il
// permesso per l'operazione l'istruzione fallisce con «permission denied». Nello schema public ogni vista ha
// security_invoker, e non ci sono viste materializzate né tabelle esterne (nota (10)(c)): leggerebbero le tabelle senza
// la RLS di chi le interroga. I controlli sul catalogo sono funzioni che ricevono un client, provate anche sul caso che
// deve fallire in una transazione del proprietario annullata. La riga da copiare e il caso NEG-003 usano testo SQL con
// pg, nomi quotati dal catalogo e valori come parametri (nota (10)(d)).

const owner = () => rolePool('owner');
const SUBDOMAINS = ['negozio-a', 'negozio-b'];
const POLICY_VIOLATION = /^new row violates row-level security policy/;
const PERMISSION_DENIED = /^permission denied for table/;

let appPool: Pool;
let context: DbContext;
let shopA: FixtureShop;
let shopB: FixtureShop;

beforeAll(async () => {
  // Negozi rimasti da un'esecuzione interrotta: senza, la creazione fallirebbe sul sottodominio unico.
  await owner().query('DELETE FROM public.shops WHERE subdomain = ANY($1::text[])', [SUBDOMAINS]);
  shopA = await createFixtureShop(owner(), { subdomain: 'negozio-a', name: 'Negozio A', userId: 'fixture-user-a' });
  shopB = await createFixtureShop(owner(), { subdomain: 'negozio-b', name: 'Negozio B', userId: 'fixture-user-b' });
  for (const fixture of Object.values(SHOP_DATA_FIXTURES)) {
    await fixture(owner(), shopA);
    await fixture(owner(), shopB);
  }
  appPool = new Pool({ connectionString: testDatabaseUrl('app'), max: 1 });
  appPool.on('error', () => undefined);
  context = createDbContext(appPool);
});

afterAll(async () => {
  // Le righe delle altre tabelle seguono il negozio (ON DELETE CASCADE).
  await owner().query('DELETE FROM public.shops WHERE subdomain = ANY($1::text[])', [SUBDOMAINS]);
  await appPool?.end();
  await closeRolePools();
});

interface ShopTable {
  table: string;
  /** La colonna del negozio: shop_id, oppure id per shops. */
  key: string;
}

/** Le tabelle di negozio viste dal client: shops e le tabelle di public con una colonna shop_id. */
async function shopTables(client: CatalogClient): Promise<ShopTable[]> {
  const result = await client.query<{ table: string }>(
    `SELECT DISTINCT c.relname::text AS "table"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'shop_id' AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY 1`,
  );
  return [{ table: 'shops', key: 'id' }, ...result.rows.map((row) => ({ table: row.table, key: 'shop_id' }))];
}

/** NEG-002 sul catalogo visto dal client: ogni tabella di negozio con RLS abilitata, forzata e almeno una policy. */
async function rlsViolations(client: CatalogClient): Promise<string[]> {
  const tables = (await shopTables(client)).map((entry) => entry.table);
  const result = await client.query<{ table: string; enabled: boolean; forced: boolean; policies: number }>(
    `SELECT c.relname::text AS "table", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
      ORDER BY 1`,
    [tables],
  );
  const violations: string[] = [];
  for (const row of result.rows) {
    if (!row.enabled) violations.push(`${row.table}: RLS non abilitata`);
    if (!row.forced) violations.push(`${row.table}: RLS non forzata`);
    if (row.policies === 0) violations.push(`${row.table}: nessuna policy`);
  }
  return violations;
}

/**
 * Le relazioni di public che non sono tabelle e leggono senza la RLS di chi le interroga: viste senza security_invoker
 * (leggono con i permessi del proprietario), viste materializzate (non hanno RLS) e tabelle esterne.
 */
async function nonTableViolations(client: CatalogClient): Promise<string[]> {
  const result = await client.query<{ relation: string; kind: string; invoker: boolean }>(
    `SELECT c.relname::text AS relation, c.relkind::text AS kind,
            coalesce((SELECT o.option_value::boolean FROM pg_options_to_table(c.reloptions) o
                       WHERE o.option_name = 'security_invoker'), false) AS invoker
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'f')
      ORDER BY 1`,
  );
  return result.rows.flatMap((row) => {
    if (row.kind === 'v') return row.invoker ? [] : [`${row.relation}: vista senza security_invoker`];
    if (row.kind === 'm') return [`${row.relation}: vista materializzata`];
    return [`${row.relation}: tabella esterna`];
  });
}

/** Ogni tabella di negozio diversa da shops ha la sua fixture, e ogni fixture è una tabella di negozio. */
async function fixtureViolations(client: CatalogClient): Promise<string[]> {
  const tables = (await shopTables(client)).map((entry) => entry.table).filter((table) => table !== 'shops');
  const fixtures = Object.keys(SHOP_DATA_FIXTURES);
  return [
    ...tables
      .filter((table) => !fixtures.includes(table))
      .map((table) => `${table}: tabella con shop_id senza fixture`),
    ...fixtures
      .filter((fixture) => !tables.includes(fixture))
      .map((fixture) => `${fixture}: fixture senza una tabella con shop_id`),
  ];
}

interface AppUserAccess {
  select: boolean;
  delete: boolean;
  insertColumns: ColumnInfo[];
  updateColumns: string[];
}

/** I permessi effettivi di app_user sulla tabella, letti dal catalogo (relacl e attacl). */
async function appUserAccess({ table, key }: ShopTable): Promise<AppUserAccess> {
  const grants = (await effectiveTableGrants(owner(), 'public', ['app_user'])).filter((g) => g.table === table);
  const columns = await columnsOf(owner(), table);
  const onTable = (privilege: string) => grants.some((g) => g.privilege === privilege && g.column === null);
  const onColumns = (privilege: string) =>
    grants.filter((g) => g.privilege === privilege && g.column !== null).map((g) => g.column!);
  const writable = columns.filter((column) => column.writable);
  const insertable = onTable('INSERT') ? writable.map((c) => c.name) : onColumns('INSERT');
  return {
    select: onTable('SELECT') || onColumns('SELECT').includes(key),
    delete: onTable('DELETE'),
    insertColumns: writable.filter((column) => insertable.includes(column.name)),
    updateColumns: onTable('UPDATE') ? writable.map((c) => c.name) : onColumns('UPDATE'),
  };
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;
const tableRef = (table: string) => sql`${sql.identifier('public')}.${sql.identifier(table)}`;
const matches = (table: string, key: string, shop: FixtureShop) =>
  sql`${tableRef(table)}.${sql.identifier(key)} = ${shop.id}::uuid`;

/** Una riga del negozio letta dal proprietario, ogni colonna come testo (null resta null). */
async function rowOf(table: string, key: string, shop: FixtureShop, columns: ColumnInfo[]) {
  const list = columns.map((column) => `${quoteIdent(column.name)}::text AS ${quoteIdent(column.name)}`).join(', ');
  const result = await owner().query<Record<string, string | null>>(
    `SELECT ${list} FROM public.${quoteIdent(table)} WHERE ${quoteIdent(key)} = $1::uuid LIMIT 1`,
    [shop.id],
  );
  return result.rows[0];
}

/** L'INSERT di una copia della riga, con le sole colonne date e i valori con il cast al tipo della colonna. */
function insertCopy(table: string, columns: ColumnInfo[], row: Record<string, string | null>): SQL {
  const names = sql.join(
    columns.map((column) => sql.identifier(column.name)),
    sql`, `,
  );
  const values = sql.join(
    columns.map((column) => sql`${row[column.name] ?? null}::${sql.raw(column.type)}`),
    sql`, `,
  );
  return sql`INSERT INTO ${tableRef(table)} (${names}) VALUES (${values})`;
}

type Outcome = { ok: true; rowCount: number; rows: Record<string, unknown>[] } | { ok: false; error: unknown };

/** L'istruzione con il contesto del negozio (withShop con il suo utente), in una transazione sua. */
async function inShop(shop: FixtureShop, statement: SQL): Promise<Outcome> {
  try {
    const result = await context.withShop({ shopId: shop.id, userId: shop.userId, actor: 'user' }, (tx) =>
      tx.execute(statement),
    );
    return { ok: true, rowCount: result.rowCount ?? 0, rows: result.rows };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Vero se l'esito è il rifiuto con 42501 e il messaggio indicato (DbError conserva il messaggio della classe 42). */
function refused(outcome: Outcome, message: RegExp): boolean {
  return (
    !outcome.ok &&
    outcome.error instanceof DbError &&
    outcome.error.code === '42501' &&
    message.test(outcome.error.message)
  );
}

const describeOutcome = (outcome: Outcome) =>
  outcome.ok
    ? `${outcome.rowCount} righe`
    : outcome.error instanceof Error
      ? outcome.error.message
      : String(outcome.error);

describe('tabelle di negozio e fixture', () => {
  it('NEG-002: ogni tabella di negozio (con shop_id, più shops) ha RLS abilitata e forzata e almeno una policy', async () => {
    const tables = (await shopTables(owner())).map((entry) => entry.table);
    expect(tables).toEqual(expect.arrayContaining(['shops', 'audit_log']));
    expect(await rlsViolations(owner())).toEqual([]);
  });

  it('NEG-002: il controllo segnala una tabella con shop_id senza RLS, senza FORCE o senza policy', async () => {
    const client = await owner().connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TABLE public.neg_t05_senza_rls (shop_id uuid)');
      await client.query('CREATE TABLE public.neg_t05_senza_force (shop_id uuid)');
      await client.query('ALTER TABLE public.neg_t05_senza_force ENABLE ROW LEVEL SECURITY');
      await client.query('CREATE POLICY prova ON public.neg_t05_senza_force USING (true)');
      expect(await rlsViolations(client)).toEqual(
        expect.arrayContaining([
          'neg_t05_senza_rls: RLS non abilitata',
          'neg_t05_senza_rls: RLS non forzata',
          'neg_t05_senza_rls: nessuna policy',
          'neg_t05_senza_force: RLS non forzata',
        ]),
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('NEG-002: nello schema public ogni vista ha security_invoker e non ci sono viste materializzate né tabelle esterne', async () => {
    expect(await nonTableViolations(owner())).toEqual([]);
  });

  it('NEG-002: il controllo segnala una vista senza security_invoker e una vista materializzata, non una vista con security_invoker', async () => {
    const client = await owner().connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE VIEW public.neg_t05_vista AS SELECT name FROM public.shops');
      await client.query(
        'CREATE VIEW public.neg_t05_vista_invoker WITH (security_invoker = true) AS SELECT name FROM public.shops',
      );
      await client.query(
        'CREATE MATERIALIZED VIEW public.neg_t05_vista_materializzata AS SELECT name FROM public.shops',
      );
      const violations = await nonTableViolations(client);
      expect(violations).toEqual(
        expect.arrayContaining([
          'neg_t05_vista: vista senza security_invoker',
          'neg_t05_vista_materializzata: vista materializzata',
        ]),
      );
      expect(violations.filter((violation) => violation.startsWith('neg_t05_vista_invoker'))).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('NEG-004: ogni tabella di negozio diversa da shops ha la sua fixture, e ogni fixture è una tabella di negozio', async () => {
    expect(await fixtureViolations(owner())).toEqual([]);
  });

  it('NEG-004: il controllo segnala una tabella con shop_id senza fixture', async () => {
    const client = await owner().connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TABLE public.neg_t05_senza_fixture (shop_id uuid)');
      expect(await fixtureViolations(client)).toContain('neg_t05_senza_fixture: tabella con shop_id senza fixture');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('NEG-004: le fixture sono inerti (negozio trial, is_test falso, purge_requested_at nullo, utenti diversi, una riga per tabella) e con isTest e purgeRequested danno i negozi di isolation-check', async () => {
    expect(shopA.userId).not.toBe(shopB.userId);
    const shops = await owner().query(
      `SELECT id::text AS id, subdomain, status, is_test, purge_requested_at IS NULL AS no_purge
         FROM public.shops WHERE id = ANY($1::uuid[]) ORDER BY subdomain`,
      [[shopA.id, shopB.id]],
    );
    expect(shops.rows).toEqual([
      { id: shopA.id, subdomain: 'negozio-a', status: 'trial', is_test: false, no_purge: true },
      { id: shopB.id, subdomain: 'negozio-b', status: 'trial', is_test: false, no_purge: true },
    ]);
    for (const table of Object.keys(SHOP_DATA_FIXTURES)) {
      for (const shop of [shopA, shopB]) {
        const rows = await owner().query(`SELECT 1 FROM public.${quoteIdent(table)} WHERE shop_id = $1::uuid`, [
          shop.id,
        ]);
        expect(rows.rowCount, `${table} ${shop.subdomain}`).toBeGreaterThan(0);
      }
    }

    const client = await owner().connect();
    try {
      await client.query('BEGIN');
      const subdomain = `neg-t05-${randomUUID().slice(0, 8)}`;
      const check = await createFixtureShop(client, {
        subdomain,
        name: 'Negozio di isolation-check',
        userId: 'fixture-user-c',
        isTest: true,
        purgeRequested: true,
      });
      expect(check).toMatchObject({ subdomain, userId: 'fixture-user-c' });
      const row = await client.query(
        'SELECT status, is_test, purge_requested_at IS NOT NULL AS purge FROM public.shops WHERE id = $1::uuid',
        [check.id],
      );
      expect(row.rows).toEqual([{ status: 'trial', is_test: true, purge: true }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('separazione con il contesto di un negozio', () => {
  it('NEG-002 NEG-004: con il contesto di A, su ogni tabella di negozio app_user non legge, non modifica, non cancella e non inserisce righe di B', async () => {
    const violations: string[] = [];
    for (const entry of await shopTables(owner())) {
      const { table, key } = entry;
      const access = await appUserAccess(entry);
      const count = (shop: FixtureShop) =>
        sql`SELECT count(*)::int AS n FROM ${tableRef(table)} WHERE ${matches(table, key, shop)}`;

      // SELECT: 0 righe di B, e almeno una di A (la fixture si vede: il conteggio di B non è vuoto per sbaglio).
      if (access.select) {
        const ofB = await inShop(shopA, count(shopB));
        if (!ofB.ok || ofB.rows[0]?.n !== 0) violations.push(`${table}: SELECT di B dà ${describeOutcome(ofB)}`);
        const ofA = await inShop(shopA, count(shopA));
        if (!ofA.ok || !((ofA.rows[0]?.n as number) > 0)) {
          violations.push(`${table}: SELECT di A non vede la fixture (${describeOutcome(ofA)})`);
        }
      } else if (!refused(await inShop(shopA, count(shopB)), PERMISSION_DENIED)) {
        violations.push(`${table}: SELECT senza permesso non rifiutata`);
      }

      // UPDATE: 0 righe di B toccate, almeno una di A.
      const [updatable] = access.updateColumns;
      if (updatable !== undefined) {
        const column = sql.identifier(updatable);
        const update = (shop: FixtureShop) =>
          sql`UPDATE ${tableRef(table)} SET ${column} = ${column} WHERE ${matches(table, key, shop)}`;
        const ofB = await inShop(shopA, update(shopB));
        if (!ofB.ok || ofB.rowCount !== 0) violations.push(`${table}: UPDATE di B dà ${describeOutcome(ofB)}`);
        const ofA = await inShop(shopA, update(shopA));
        if (!ofA.ok || ofA.rowCount < 1) violations.push(`${table}: UPDATE di A dà ${describeOutcome(ofA)}`);
      } else {
        const keyColumn = sql.identifier(key);
        const outcome = await inShop(
          shopA,
          sql`UPDATE ${tableRef(table)} SET ${keyColumn} = ${keyColumn} WHERE ${matches(table, key, shopB)}`,
        );
        if (!refused(outcome, PERMISSION_DENIED)) {
          violations.push(`${table}: UPDATE senza permesso dà ${describeOutcome(outcome)}`);
        }
      }

      // DELETE: 0 righe di B.
      const remove = await inShop(shopA, sql`DELETE FROM ${tableRef(table)} WHERE ${matches(table, key, shopB)}`);
      if (access.delete) {
        if (!remove.ok || remove.rowCount !== 0) violations.push(`${table}: DELETE di B dà ${describeOutcome(remove)}`);
      } else if (!refused(remove, PERMISSION_DENIED)) {
        violations.push(`${table}: DELETE senza permesso dà ${describeOutcome(remove)}`);
      }

      // INSERT: una copia della riga di B, con le sole colonne permesse, rifiutata dalla policy.
      if (access.insertColumns.length > 0) {
        const row = await rowOf(table, key, shopB, access.insertColumns);
        if (row === undefined) {
          violations.push(`${table}: nessuna riga di B da copiare (fixture mancante)`);
        } else {
          const outcome = await inShop(shopA, insertCopy(table, access.insertColumns, row));
          if (!refused(outcome, POLICY_VIOLATION)) {
            violations.push(`${table}: INSERT di una riga di B dà ${describeOutcome(outcome)}`);
          }
        }
      } else {
        const outcome = await inShop(
          shopA,
          sql`INSERT INTO ${tableRef(table)} (${sql.identifier(key)}) VALUES (${shopB.id}::uuid)`,
        );
        if (!refused(outcome, PERMISSION_DENIED)) {
          violations.push(`${table}: INSERT senza permesso dà ${describeOutcome(outcome)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('NEG-003: senza contesto, sulla stessa connessione riusata dopo una transazione con contesto, ogni tabella di negozio dà 0 righe senza errori e un inserimento è rifiutato dalla policy', async () => {
    const pid = await context.withShop({ shopId: shopA.id, userId: shopA.userId, actor: 'user' }, async (tx) => {
      const result = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      return result.rows[0]!.pid;
    });
    const violations: string[] = [];
    const client = await appPool.connect();
    try {
      const same = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      expect(same.rows[0]?.pid).toBe(pid);
      for (const entry of await shopTables(owner())) {
        const { table, key } = entry;
        const access = await appUserAccess(entry);
        if (access.select) {
          const rows = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${quoteIdent(table)}`);
          if (rows.rows[0]?.n !== 0) violations.push(`${table}: senza contesto SELECT dà ${rows.rows[0]?.n} righe`);
        }
        if (access.insertColumns.length > 0) {
          const row = await rowOf(table, key, shopA, access.insertColumns);
          if (row === undefined) {
            violations.push(`${table}: nessuna riga di A da copiare (fixture mancante)`);
            continue;
          }
          const names = access.insertColumns.map((column) => quoteIdent(column.name)).join(', ');
          const values = access.insertColumns.map((column, index) => `$${index + 1}::${column.type}`).join(', ');
          try {
            await client.query(
              `INSERT INTO public.${quoteIdent(table)} (${names}) VALUES (${values})`,
              access.insertColumns.map((column) => row[column.name] ?? null),
            );
            violations.push(`${table}: senza contesto INSERT accettato`);
          } catch (error) {
            const { code, message } = error as { code?: string; message: string };
            if (code !== '42501' || !POLICY_VIOLATION.test(message)) {
              violations.push(`${table}: senza contesto INSERT dà ${code} ${message}`);
            }
          }
        }
      }
    } finally {
      client.release();
    }
    expect(violations).toEqual([]);
  });
});
