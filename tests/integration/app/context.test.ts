import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { audit } from '@/server/audit';
import { closeDb } from '@/server/db/client';
import { createDbContext, type NewShopInput, type Tx, withNewShop, withShop, withUser } from '@/server/db/context';
import { DbError, dbErrorCode } from '@/server/db/errors';
import * as schema from '@/server/db/schema';
import { closeRolePools, rolePool, testDatabaseUrl } from '../../fixtures/db';

// withShop, withUser e withNewShop (02 §withShop e NEG-T02, note (1)–(3) e (8)(c) del piano) e audit() dentro il
// contesto (08 §Registro, OPS-020, OPS-021), con il ruolo vero: DATABASE_URL è app_user (progetto int-app). Le prove di
// NEG-005 usano createDbContext su un pool di una sola connessione, così la connessione riusata è sicuramente la stessa.
// I negozi li crea il proprietario e li cancella alla fine (le righe di registro seguono con ON DELETE CASCADE);
// withNewShop usa la admin_create_shop provvisoria della preparazione globale (tests/setup/int-app-functions.ts).

const TEST_ACTION = 'test_neg_t02';
const USER = 'utente-neg-t02';
const ADMIN = 'admin-neg-t02';

const owner = () => rolePool('owner');
const created: string[] = [];
const pools: Pool[] = [];

afterAll(async () => {
  await owner().query('DELETE FROM public.shops WHERE id = ANY($1::uuid[])', [created]);
  await owner().query('DELETE FROM public.audit_log WHERE action = $1', [TEST_ACTION]);
  await Promise.all(pools.map((pool) => pool.end()));
  await closeDb();
  await closeRolePools();
});

/** Un pool di una sola connessione con app_user e il suo contesto (createDbContext). */
function singleConnection() {
  const pool = new Pool({ connectionString: testDatabaseUrl('app'), max: 1 });
  pool.on('error', () => undefined);
  pools.push(pool);
  return { pool, context: createDbContext(pool) };
}

/** Un negozio `trial` creato dal proprietario e cancellato alla fine. */
async function createShop(name = 'Negozio di prova NEG-T02'): Promise<string> {
  const result = await owner().query<{ id: string }>(
    'INSERT INTO public.shops (name, subdomain) VALUES ($1, $2) RETURNING id::text AS id',
    [name, `neg-t02-${randomUUID().slice(0, 8)}`],
  );
  const id = result.rows[0]!.id;
  created.push(id);
  return id;
}

function newShopInput(overrides: Partial<NewShopInput> = {}): NewShopInput {
  return { name: 'Negozio creato NEG-T02', subdomain: `neg-t02-${randomUUID().slice(0, 8)}`, ...overrides };
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('la promessa doveva fallire');
}

function rootCause(error: unknown): unknown {
  let current = error;
  while (current instanceof Error && current.cause !== undefined) current = current.cause;
  return current;
}

/**
 * La chiamata non lancia in modo sincrono e restituisce una promessa (nota (10)(c) del ritorno al piano: un argomento
 * sbagliato dà sempre una promessa rifiutata, mai un'eccezione sincrona).
 */
function asPromise(run: () => unknown): Promise<unknown> {
  let result: unknown;
  expect(() => {
    result = run();
  }).not.toThrow();
  expect(result).toBeInstanceOf(Promise);
  return result as Promise<unknown>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** L'errore del proxy revocato: TypeError «… on a proxy that has been revoked», anche dentro l'errore di Drizzle. */
function expectRevoked(error: unknown): void {
  const cause = rootCause(error);
  expect(cause).toBeInstanceOf(TypeError);
  expect((cause as Error).message).toMatch(/revoked/);
}

// Un tipo letterale e non un'interfaccia: tx.execute<T> di Drizzle chiede T extends Record<string, unknown>, che
// un'interfaccia (senza firma d'indice) non soddisfa.
type InsideRow = {
  pid: number;
  shop: string | null;
  user: string | null;
  app_shop: string | null;
};

const INSIDE = sql`SELECT pg_backend_pid() AS pid, current_setting('app.shop_id', true) AS shop,
                          current_setting('app.user_id', true) AS "user", public.app_shop_id()::text AS app_shop`;

async function inside(tx: Tx): Promise<InsideRow> {
  return (await tx.execute<InsideRow>(INSIDE)).rows[0]!;
}

interface AfterRow {
  pid: number;
  shop: string | null;
  user: string | null;
  fresh: boolean;
}

/** Sulla connessione del pool, fuori da withShop: contesto e se l'istruzione apre una transazione nuova. */
async function afterCommit(pool: Pool): Promise<AfterRow> {
  const result = await pool.query<AfterRow>(
    `SELECT pg_backend_pid() AS pid, current_setting('app.shop_id', true) AS shop,
            current_setting('app.user_id', true) AS "user", now() = statement_timestamp() AS fresh`,
  );
  return result.rows[0]!;
}

function expectClean(after: AfterRow, pid: number): void {
  expect(after.pid).toBe(pid);
  expect(['', null]).toContain(after.shop);
  expect(['', null]).toContain(after.user);
  expect(after.fresh).toBe(true);
}

const shopCount = (tx: Tx, shopId: string) =>
  tx.select({ id: schema.shops.id }).from(schema.shops).where(eq(schema.shops.id, shopId));

describe('contesto della transazione', () => {
  it('NEG-005: withShop imposta app.shop_id e app.user_id; dopo il COMMIT la stessa connessione non li conserva ed è fuori da ogni transazione', async () => {
    const shopId = await createShop();
    const { pool, context } = singleConnection();
    const row = await context.withShop({ shopId, userId: USER, actor: 'user' }, inside);
    expect(row).toMatchObject({ shop: shopId, user: USER, app_shop: shopId });
    expectClean(await afterCommit(pool), row.pid);
  });

  it('NEG-005: withUser imposta app.user_id senza negozio; dopo il COMMIT la stessa connessione non conserva nulla', async () => {
    const { pool, context } = singleConnection();
    const row = await context.withUser(USER, inside);
    expect(row.user).toBe(USER);
    expect(['', null]).toContain(row.shop);
    expect(row.app_shop).toBeNull();
    expectClean(await afterCommit(pool), row.pid);
  });

  it('NEG-005: withNewShop imposta l’amministratore e il negozio creato; dopo il COMMIT la stessa connessione non conserva nulla', async () => {
    const { pool, context } = singleConnection();
    const row = await context.withNewShop(newShopInput(), ADMIN, async (tx, shopId) => {
      created.push(shopId);
      return { shopId, ...(await inside(tx)) };
    });
    expect(row).toMatchObject({ shop: row.shopId, user: ADMIN, app_shop: row.shopId });
    expectClean(await afterCommit(pool), row.pid);
  });

  it('NEG-005: dopo un fn fallito (ROLLBACK) la stessa connessione torna senza contesto e fuori da ogni transazione', async () => {
    const shopId = await createShop();
    const { pool, context } = singleConnection();
    let pid = 0;
    const failure = new Error('fallito apposta');
    const error = await errorOf(
      context.withShop({ shopId, userId: USER, actor: 'user' }, async (tx) => {
        pid = (await inside(tx)).pid;
        throw failure;
      }),
    );
    expect(error).toBe(failure);
    expectClean(await afterCommit(pool), pid);
  });

  it('NEG-003: con withUser (solo app.user_id) un negozio visibile con withShop dà 0 righe', async () => {
    const shopId = await createShop();
    const inShop = await withShop({ shopId, userId: USER, actor: 'user' }, (tx) => shopCount(tx, shopId));
    expect(inShop).toHaveLength(1);
    const inUser = await withUser(USER, (tx) => shopCount(tx, shopId));
    expect(inUser).toHaveLength(0);
  });
});

describe('revoca della connessione', () => {
  it('NEG-005: un tx conservato dopo withShop(A) e usato dentro withShop(B), sulla stessa connessione, solleva l’errore del proxy invece di leggere il contesto di B', async () => {
    const [a, b] = [await createShop(), await createShop()];
    const { context } = singleConnection();
    let leaked: Tx | undefined;
    await context.withShop({ shopId: a, userId: null, actor: 'system' }, async (tx) => {
      leaked = tx;
    });
    const result = await context.withShop({ shopId: b, userId: null, actor: 'system' }, async (tx) => ({
      error: await errorOf(leaked!.execute(sql`SELECT public.app_shop_id()::text AS id`)),
      own: (await inside(tx)).app_shop,
    }));
    expectRevoked(result.error);
    expect(result.own).toBe(b);
  });

  it('NEG-005: la revoca vale anche dopo un fn fallito e per un tx restituito da fn', async () => {
    const [a, b] = [await createShop(), await createShop()];
    const { context } = singleConnection();
    let afterFailure: Tx | undefined;
    await errorOf(
      context.withShop({ shopId: a, userId: null, actor: 'system' }, async (tx) => {
        afterFailure = tx;
        throw new Error('fallito apposta');
      }),
    );
    const returned = await context.withShop({ shopId: a, userId: null, actor: 'system' }, async (tx) => tx);
    const errors = await context.withShop({ shopId: b, userId: null, actor: 'system' }, async () => [
      await errorOf(afterFailure!.execute(sql`SELECT 1`)),
      await errorOf(returned.execute(sql`SELECT 1`)),
    ]);
    for (const error of errors) expectRevoked(error);
  });

  it('NEG-005: la revoca vale per il tx di withUser e per quello di withNewShop', async () => {
    const b = await createShop();
    const { context } = singleConnection();
    const fromUser = await context.withUser(USER, async (tx) => tx);
    const fromNewShop = await context.withNewShop(newShopInput(), ADMIN, async (tx, shopId) => {
      created.push(shopId);
      return tx;
    });
    const errors = await context.withShop({ shopId: b, userId: null, actor: 'system' }, async () => [
      await errorOf(fromUser.execute(sql`SELECT 1`)),
      await errorOf(fromNewShop.execute(sql`SELECT 1`)),
    ]);
    for (const error of errors) expectRevoked(error);
  });

  it('NEG-005: un costruttore di query creato dentro fn ed eseguito dopo viene rifiutato', async () => {
    const [a, b] = [await createShop(), await createShop()];
    const { context } = singleConnection();
    const { query } = await context.withShop({ shopId: a, userId: null, actor: 'system' }, async (tx) => ({
      query: shopCount(tx, a),
    }));
    const error = await context.withShop({ shopId: b, userId: null, actor: 'system' }, async () => errorOf(query));
    expectRevoked(error);
  });

  it('NEG-005: una transazione annidata e una query relazionale di un tx conservato sono rifiutate dentro withShop(B)', async () => {
    const [a, b] = [await createShop(), await createShop()];
    const { context } = singleConnection();
    const leaked = await context.withShop({ shopId: a, userId: null, actor: 'system' }, async (tx) => tx);
    const result = await context.withShop({ shopId: b, userId: null, actor: 'system' }, async (tx) => ({
      nested: await errorOf(leaked.transaction(async (sp) => sp.execute(sql`SELECT public.app_shop_id()::text AS id`))),
      relational: await errorOf(leaked.query.shops.findMany()),
      own: (await inside(tx)).app_shop,
    }));
    expectRevoked(result.nested);
    expectRevoked(result.relational);
    expect(result.own).toBe(b);
  });
});

describe('transazione fallita dentro fn', () => {
  it('02§withShop: se fn intercetta un errore del database senza savepoint e restituisce, la promessa è rifiutata e non resta nulla', async () => {
    const shopId = await createShop();
    const objectId = `annullata-${randomUUID()}`;
    const error = await errorOf(
      withShop({ shopId, userId: USER, actor: 'user' }, async (tx) => {
        await audit(tx, { actorType: 'user', action: TEST_ACTION, objectType: 'prova', objectId });
        await errorOf(tx.execute(sql`SELECT 1/0 AS impossibile`));
        return 'ok';
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/nulla è stato salvato/);
    const rows = await owner().query('SELECT 1 FROM public.audit_log WHERE object_id = $1', [objectId]);
    expect(rows.rowCount).toBe(0);
  });

  it('02§withShop: con withNewShop, se fn intercetta un errore senza savepoint e restituisce, la promessa è rifiutata e il negozio non esiste', async () => {
    let captured: string | undefined;
    const error = await errorOf(
      withNewShop(newShopInput(), ADMIN, async (tx, shopId) => {
        captured = shopId;
        created.push(shopId); // se il negozio restasse, la pulizia lo toglie comunque
        await errorOf(tx.execute(sql`SELECT 1/0 AS impossibile`));
        return shopId;
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/nulla è stato salvato/);
    expect(captured).toBeDefined();
    const shops = await owner().query('SELECT 1 FROM public.shops WHERE id = $1', [captured]);
    expect(shops.rowCount).toBe(0);
  });

  it('02§withShop: dentro fn un errore in un savepoint, intercettato attorno a tx.transaction, è il DrizzleQueryError con il suo codice, e la transazione prosegue fino al commit', async () => {
    const shopId = await createShop();
    const [rejected, kept] = [`savepoint-a-${randomUUID()}`, `savepoint-b-${randomUUID()}`];
    const failure = await withShop({ shopId, userId: USER, actor: 'user' }, async (tx) => {
      const caught = await errorOf(
        tx.transaction((sp) =>
          audit(sp, { actorType: 'invalido' as never, action: TEST_ACTION, objectType: 'prova', objectId: rejected }),
        ),
      );
      await audit(tx, { actorType: 'user', action: TEST_ACTION, objectType: 'prova', objectId: kept });
      return caught;
    });
    expect(failure).toBeInstanceOf(DrizzleQueryError);
    expect(failure).not.toBeInstanceOf(DbError);
    expect(dbErrorCode(failure)).toBe('23514');
    const rows = await owner().query('SELECT object_id FROM public.audit_log WHERE object_id = ANY($1::text[])', [
      [rejected, kept],
    ]);
    expect(rows.rows).toEqual([{ object_id: kept }]);
  });
});

describe('connessione chiusa dal server', () => {
  it('02§withShop: una connessione chiusa dal server fra due istruzioni non termina il processo, la promessa è rifiutata senza SQLSTATE e la chiamata successiva usa una connessione nuova', async () => {
    const shopId = await createShop();
    const { context } = singleConnection();
    let pid = 0;
    const error = await errorOf(
      context.withShop({ shopId, userId: null, actor: 'system' }, async (tx) => {
        pid = (await inside(tx)).pid;
        await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '100ms'`);
        await sleep(500);
        await tx.execute(sql`SELECT 1 AS dopo`);
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DbError);
    expect(dbErrorCode(error)).toBeUndefined();
    const next = await context.withShop({ shopId, userId: null, actor: 'system' }, inside);
    expect(next.app_shop).toBe(shopId);
    expect(next.pid).not.toBe(pid);
  });
});

describe('argomenti e sola lettura', () => {
  it('02§withShop: argomenti sbagliati danno errore senza prendere connessioni dal pool', async () => {
    const { pool, context } = singleConnection();
    const shopId = randomUUID();
    await expect(
      asPromise(() => context.withShop({ shopId: 'non-un-uuid', userId: null, actor: 'system' }, async () => 1)),
    ).rejects.toThrow();
    await expect(
      asPromise(() => context.withShop({ shopId: shopId.toUpperCase(), userId: null, actor: 'system' }, async () => 1)),
    ).rejects.toThrow();
    await expect(
      asPromise(() => context.withShop({ shopId, userId: '', actor: 'user' }, async () => 1)),
    ).rejects.toThrow();
    await expect(asPromise(() => context.withUser('', async () => 1))).rejects.toThrow();
    await expect(asPromise(() => context.withNewShop(newShopInput(), '', async () => 1))).rejects.toThrow();
    expect(pool.totalCount).toBe(0);
  });

  it('02§withShop: con readOnly la transazione è in sola lettura e audit() fallisce con 25006; senza readOnly è in scrittura', async () => {
    const shopId = await createShop();
    const readOnly = (tx: Tx) =>
      tx.execute<{ ro: string }>(sql`SELECT current_setting('transaction_read_only') AS ro`).then((r) => r.rows[0]?.ro);
    expect(await withShop({ shopId, userId: null, actor: 'system', readOnly: true }, readOnly)).toBe('on');
    expect(await withShop({ shopId, userId: null, actor: 'system' }, readOnly)).toBe('off');
    const error = await errorOf(
      withShop({ shopId, userId: null, actor: 'system', readOnly: true }, (tx) =>
        audit(tx, { actorType: 'system', action: TEST_ACTION }),
      ),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '25006' });
  });
});

describe('audit() dentro il contesto', () => {
  it('NEG-013: audit() dentro withShop scrive la riga con shop_id e actor_user_id del contesto, visibile nel contesto del negozio', async () => {
    const shopId = await createShop();
    const objectId = `riga-${randomUUID()}`;
    const visible = await withShop({ shopId, userId: USER, actor: 'user' }, async (tx) => {
      await audit(tx, {
        actorType: 'user',
        action: TEST_ACTION,
        objectType: 'prova',
        objectId,
        before: { stato: 'prima' },
        after: { stato: 'dopo' },
        ip: '192.0.2.10',
        userAgent: 'vitest NEG-T02',
      });
      const rows = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM public.audit_log WHERE object_id = ${objectId}`,
      );
      return rows.rows[0]?.n;
    });
    expect(visible).toBe(1);

    const stored = await owner().query(
      `SELECT shop_id::text AS shop_id, actor_type, actor_user_id, action, object_type, before, after, host(ip) AS ip,
              user_agent
         FROM public.audit_log WHERE object_id = $1`,
      [objectId],
    );
    expect(stored.rows).toEqual([
      {
        shop_id: shopId,
        actor_type: 'user',
        actor_user_id: USER,
        action: TEST_ACTION,
        object_type: 'prova',
        before: { stato: 'prima' },
        after: { stato: 'dopo' },
        ip: '192.0.2.10',
        user_agent: 'vitest NEG-T02',
      },
    ]);
  });

  it('NEG-013: con userId nullo (lavori di sistema) la riga ha actor_user_id nullo', async () => {
    const shopId = await createShop();
    const objectId = `sistema-${randomUUID()}`;
    await withShop({ shopId, userId: null, actor: 'system' }, (tx) =>
      audit(tx, { actorType: 'system', action: TEST_ACTION, objectType: 'prova', objectId }),
    );
    const stored = await owner().query(
      'SELECT shop_id::text AS shop_id, actor_type, actor_user_id FROM public.audit_log WHERE object_id = $1',
      [objectId],
    );
    expect(stored.rows).toEqual([{ shop_id: shopId, actor_type: 'system', actor_user_id: null }]);
  });

  it('NEG-013: shopId e actorUserId messi nell’entry da chi chiama non contano: la riga prende negozio e utente dal contesto', async () => {
    const [shopId, other] = [await createShop(), await createShop()];
    // Oggetti restituiti da una funzione e non letterali scritti nella chiamata: TypeScript non segnala le proprietà in
    // più, come per un oggetto preparato altrove (nota (3) del piano: l'entry non porta shopId né actorUserId).
    const forged = (objectId: string, actorType: 'user' | 'system') => ({
      actorType,
      action: TEST_ACTION,
      objectType: 'prova',
      objectId,
      shopId: other,
      actorUserId: 'altro-utente-neg-t02',
    });
    const asUser = `forzata-utente-${randomUUID()}`;
    const asSystem = `forzata-sistema-${randomUUID()}`;
    await withShop({ shopId, userId: USER, actor: 'user' }, (tx) => audit(tx, forged(asUser, 'user')));
    await withShop({ shopId, userId: null, actor: 'system' }, (tx) => audit(tx, forged(asSystem, 'system')));
    const stored = async (objectId: string) =>
      (
        await owner().query(
          'SELECT shop_id::text AS shop_id, actor_user_id FROM public.audit_log WHERE object_id = $1',
          [objectId],
        )
      ).rows;
    expect(await stored(asUser)).toEqual([{ shop_id: shopId, actor_user_id: USER }]);
    expect(await stored(asSystem)).toEqual([{ shop_id: shopId, actor_user_id: null }]);
  });

  it('NEG-013: l’entry di audit() non ha shopId né actorUserId (lo controlla pnpm typecheck)', () => {
    expectTypeOf<Parameters<typeof audit>[1]>().not.toHaveProperty('shopId');
    expectTypeOf<Parameters<typeof audit>[1]>().not.toHaveProperty('actorUserId');
  });

  it('NEG-003: audit() senza contesto di negozio è rifiutato dalla policy di audit_log (dentro withUser e in una transazione senza contesto)', async () => {
    const objectId = `senza-contesto-${randomUUID()}`;
    const entry = { actorType: 'user' as const, action: TEST_ACTION, objectType: 'prova', objectId };

    const inUser = await errorOf(withUser(USER, (tx) => audit(tx, entry)));
    expect(inUser).toBeInstanceOf(DbError);
    expect(inUser).toMatchObject({ code: '42501' });
    expect((inUser as DbError).message).toMatch(/^new row violates row-level security policy for table "audit_log"/);

    const appDb = drizzle({ client: rolePool('app'), schema });
    const bare = await errorOf(appDb.transaction((tx) => audit(tx, entry)));
    expect(dbErrorCode(bare)).toBe('42501');
    expect((rootCause(bare) as Error).message).toMatch(
      /^new row violates row-level security policy for table "audit_log"/,
    );

    const left = await owner().query('SELECT 1 FROM public.audit_log WHERE object_id = $1', [objectId]);
    expect(left.rowCount).toBe(0);
  });

  it('OPS-020: se la scrittura del registro è rifiutata da un vincolo, la modifica del negozio nella stessa transazione viene annullata', async () => {
    const shopId = await createShop('Nome originale NEG-T02');
    const error = await errorOf(
      withShop({ shopId, userId: USER, actor: 'user' }, async (tx) => {
        await tx.update(schema.shops).set({ name: 'Nome cambiato NEG-T02' }).where(eq(schema.shops.id, shopId));
        await audit(tx, { actorType: 'invalido' as never, action: TEST_ACTION, objectType: 'shop', objectId: shopId });
      }),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '23514', constraint: 'audit_log_actor_type_check' });

    const shop = await owner().query('SELECT name FROM public.shops WHERE id = $1', [shopId]);
    expect(shop.rows).toEqual([{ name: 'Nome originale NEG-T02' }]);
    const rows = await owner().query('SELECT 1 FROM public.audit_log WHERE shop_id = $1', [shopId]);
    expect(rows.rowCount).toBe(0);
  });

  it('OPS-021: dentro withShop app_user non può modificare né cancellare righe di audit_log', async () => {
    const shopId = await createShop();
    const objectId = `ops-021-${randomUUID()}`;
    await withShop({ shopId, userId: USER, actor: 'user' }, (tx) =>
      audit(tx, { actorType: 'user', action: TEST_ACTION, objectType: 'prova', objectId }),
    );
    const statements = [
      sql`UPDATE public.audit_log SET action = 'modificata' WHERE object_id = ${objectId}`,
      sql`DELETE FROM public.audit_log WHERE object_id = ${objectId}`,
    ];
    for (const statement of statements) {
      const error = await errorOf(withShop({ shopId, userId: USER, actor: 'user' }, (tx) => tx.execute(statement)));
      expect(error).toBeInstanceOf(DbError);
      expect(error).toMatchObject({ code: '42501' });
      expect((error as DbError).message).toMatch(/^permission denied for table audit_log/);
    }
    const rows = await owner().query('SELECT action FROM public.audit_log WHERE object_id = $1', [objectId]);
    expect(rows.rows).toEqual([{ action: TEST_ACTION }]);
  });

  it('00§4.2: un audit() fallito non porta nell’errore i valori di before, after, ip e user agent', async () => {
    const shopId = await createShop();
    const values = {
      before: 'valore-before-segreto',
      after: 'valore-after-segreto',
      ip: '198.51.100.77',
      userAgent: 'agente-segreto/1.0',
    };
    const error = await errorOf(
      withShop({ shopId, userId: USER, actor: 'user' }, (tx) =>
        audit(tx, {
          actorType: 'invalido' as never,
          action: TEST_ACTION,
          before: { campo: values.before },
          after: { campo: values.after },
          ip: values.ip,
          userAgent: values.userAgent,
        }),
      ),
    );
    expect(error).toMatchObject({ code: '23514' });
    const text = inspect(error, { depth: null });
    for (const value of Object.values(values)) expect(text).not.toContain(value);
  });

  it('00§4.2: audit() con un ip non valido dà DbError 22P02 con il messaggio generico, senza il valore, e la modifica si annulla', async () => {
    const shopId = await createShop('Nome originale ip NEG-T02');
    for (const ip of ['', '203.0.113.5, 10.0.0.2']) {
      const error = await errorOf(
        withShop({ shopId, userId: USER, actor: 'user' }, async (tx) => {
          await tx.update(schema.shops).set({ name: 'Nome cambiato ip NEG-T02' }).where(eq(schema.shops.id, shopId));
          await audit(tx, { actorType: 'user', action: TEST_ACTION, objectType: 'shop', objectId: shopId, ip });
        }),
      );
      expect(error, ip).toBeInstanceOf(DbError);
      expect(error, ip).toMatchObject({ code: '22P02', message: 'Errore del database (codice 22P02).' });
      if (ip !== '') expect(inspect(error, { depth: null }), ip).not.toContain(ip);
    }
    const shop = await owner().query('SELECT name FROM public.shops WHERE id = $1', [shopId]);
    expect(shop.rows).toEqual([{ name: 'Nome originale ip NEG-T02' }]);
  });

  it('NEG-013: i campi assenti o nulli dell’entry si scrivono come NULL SQL, non come il valore JSON null', async () => {
    const shopId = await createShop();
    const [bare, nulls] = [`assenti-${randomUUID()}`, `nulli-${randomUUID()}`];
    await withShop({ shopId, userId: USER, actor: 'user' }, async (tx) => {
      await audit(tx, { actorType: 'user', action: TEST_ACTION, objectId: bare });
      await audit(tx, {
        actorType: 'user',
        action: TEST_ACTION,
        objectType: null,
        objectId: nulls,
        before: null,
        after: null,
        ip: null,
        userAgent: null,
      });
    });
    const stored = await owner().query(
      `SELECT object_id, object_type IS NULL AS no_type, before IS NULL AS no_before, after IS NULL AS no_after,
              ip IS NULL AS no_ip, user_agent IS NULL AS no_agent
         FROM public.audit_log WHERE object_id = ANY($1::text[]) ORDER BY object_id`,
      [[bare, nulls]],
    );
    const expected = { no_type: true, no_before: true, no_after: true, no_ip: true, no_agent: true };
    expect(stored.rows).toEqual([
      { object_id: bare, ...expected },
      { object_id: nulls, ...expected },
    ]);
  });

  it('00§4.2: un errore di sintassi di to_tsquery dentro withShop dà DbError 42601 con il messaggio generico, senza il testo cercato', async () => {
    const shopId = await createShop();
    const searched = 'Mario Rossi Segreto';
    const error = await errorOf(
      withShop({ shopId, userId: USER, actor: 'user' }, (tx) =>
        tx.execute(sql`SELECT to_tsquery('simple', ${searched}) AS q`),
      ),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '42601', message: 'Errore del database (codice 42601).' });
    expect(inspect(error, { depth: null })).not.toContain(searched);
  });
});

describe('withNewShop', () => {
  it('NEG-013: withNewShop crea il negozio con admin_create_shop, apre il suo contesto e fn scrive il registro nella stessa transazione', async () => {
    const input = newShopInput({
      legalName: 'Negozio Creato S.r.l.',
      vatNumber: '01234567890',
      taxCode: '01234567890',
      sdiCode: '0000000',
      pec: 'negozio-creato@pec.example.it',
      address: { street: 'Via Roma 1', city: 'Milano', zip: '20100', province: 'MI', country: 'IT' },
    });
    const result = await withNewShop(input, ADMIN, async (tx, shopId) => {
      created.push(shopId);
      const row = await inside(tx);
      const visible = await tx
        .select({ name: schema.shops.name })
        .from(schema.shops)
        .where(eq(schema.shops.id, shopId));
      await audit(tx, { actorType: 'admin', action: TEST_ACTION, objectType: 'shop', objectId: shopId });
      return { shopId, row, visible };
    });
    expect(result.row).toMatchObject({ shop: result.shopId, user: ADMIN, app_shop: result.shopId });
    expect(result.visible).toEqual([{ name: input.name }]);

    const shop = await owner().query(
      `SELECT name, subdomain, legal_name, vat_number, tax_code, sdi_code, pec, address, is_test, status
         FROM public.shops WHERE id = $1`,
      [result.shopId],
    );
    expect(shop.rows).toEqual([
      {
        name: input.name,
        subdomain: input.subdomain,
        legal_name: input.legalName,
        vat_number: input.vatNumber,
        tax_code: input.taxCode,
        sdi_code: input.sdiCode,
        pec: input.pec,
        address: input.address,
        is_test: false,
        status: 'trial',
      },
    ]);
    const log = await owner().query(
      'SELECT actor_type, actor_user_id, object_id FROM public.audit_log WHERE shop_id = $1 AND action = $2',
      [result.shopId, TEST_ACTION],
    );
    expect(log.rows).toEqual([{ actor_type: 'admin', actor_user_id: ADMIN, object_id: result.shopId }]);
  });

  it('NEG-013: se fn fallisce, il negozio e la riga di registro non restano', async () => {
    let captured: string | undefined;
    const failure = new Error('fallito apposta');
    const error = await errorOf(
      withNewShop(newShopInput(), ADMIN, async (tx, shopId) => {
        captured = shopId;
        created.push(shopId); // se l'annullamento non funzionasse, la pulizia lo toglie comunque
        await audit(tx, { actorType: 'admin', action: TEST_ACTION, objectType: 'shop', objectId: shopId });
        throw failure;
      }),
    );
    expect(error).toBe(failure);
    expect(captured).toBeDefined();
    const shops = await owner().query('SELECT 1 FROM public.shops WHERE id = $1', [captured]);
    expect(shops.rowCount).toBe(0);
    const rows = await owner().query('SELECT 1 FROM public.audit_log WHERE object_id = $1', [captured]);
    expect(rows.rowCount).toBe(0);
  });

  it('00§4.2: withNewShop con un sottodominio già usato dà un DbError 23505 con il nome del vincolo, senza cause né i valori passati', async () => {
    const existing = await createShop();
    const subdomain = (
      await owner().query<{ subdomain: string }>('SELECT subdomain FROM public.shops WHERE id = $1', [existing])
    ).rows[0]!.subdomain;
    const secrets = {
      name: 'Mario Rossi Segreto',
      legalName: 'Ragione Sociale Segreta S.r.l.',
      taxCode: 'RSSMRA80A01H501U',
      pec: 'segreta@pec.example.it',
    };
    const error = await errorOf(withNewShop({ ...secrets, subdomain }, ADMIN, async () => undefined));
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ name: 'DbError', code: '23505', constraint: 'shops_subdomain_unique' });
    expect((error as DbError).cause).toBeUndefined();
    // L'errore vero di pg porta anche severity, where, file, line, routine, detail: DbError porta solo codice e nomi.
    for (const [key, value] of Object.entries(error as object)) {
      if (value !== undefined) {
        expect(['name', 'message', 'stack', 'code', 'constraint', 'table', 'column', 'schema'], key).toContain(key);
      }
    }
    const text = inspect(error, { depth: null });
    for (const value of [...Object.values(secrets), subdomain]) expect(text).not.toContain(value);
  });

  it('02§withShop: dopo un DbError di withNewShop la connessione torna al pool senza contesto e fuori da ogni transazione', async () => {
    const existing = await createShop();
    const subdomain = (
      await owner().query<{ subdomain: string }>('SELECT subdomain FROM public.shops WHERE id = $1', [existing])
    ).rows[0]!.subdomain;
    const { pool, context } = singleConnection();
    const before = await afterCommit(pool);
    const error = await errorOf(context.withNewShop(newShopInput({ subdomain }), ADMIN, async () => undefined));
    expect(error).toMatchObject({ code: '23505' });
    expectClean(await afterCommit(pool), before.pid);
  });
});
