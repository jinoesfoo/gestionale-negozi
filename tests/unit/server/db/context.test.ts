import { inspect } from 'node:util';
import { sql } from 'drizzle-orm';
import { DatabaseError, type Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDbContext, type NewShopInput, type ShopCtx, type Tx } from '@/server/db/context';
import { DbError } from '@/server/db/errors';

// 02 §withShop e NEG-T02, note (1), (2) e (8)(b) del piano: prove senza database, su un pool finto che registra testo e
// parametri di ogni istruzione che Drizzle manda alla connessione. createDbContext(pool) prende una connessione con
// pool.connect(), la usa per una sola transazione e alla fine la rilascia (release), revocandone l'uso.

const SHOP = '0195f3c1-7a2b-7c3d-8e4f-5a6b7c8d9e0f';
const NEW_SHOP = '0195f3c1-7a2b-7c3d-8e4f-0000000000aa';
const USER = 'utente-neg-t02';
const ADMIN = 'admin-neg-t02';
const FN_MARKER = 'corpo di fn';

interface Recorded {
  text: string;
  params: unknown[];
}

interface FakeOptions {
  /** Errore da sollevare per l'istruzione il cui testo contiene la chiave. */
  failOn?: Record<string, Error>;
  /** Dopo il primo errore di failOn, ogni istruzione successiva fallisce con lo stesso errore (connessione persa). */
  broken?: boolean;
}

/** Il DatabaseError di pg: messaggio di PostgreSQL, codice SQLSTATE e campi separati. */
function pgError(code: string, message: string, fields: Record<string, string> = {}): Error {
  return Object.assign(new DatabaseError(message, 0, 'error'), { severity: 'ERROR', code, ...fields });
}

/** Una transazione in scrittura si apre con `begin` (o `begin read write`, che PostgreSQL tratta allo stesso modo). */
const READ_WRITE_BEGIN = /^begin(?: read write)?$/;

function fakePool(options: FakeOptions = {}) {
  const recorded: Recorded[] = [];
  let brokenBy: Error | undefined;
  const client = {
    query: vi.fn(async (config: string | { text: string }, params?: unknown[]) => {
      const text = typeof config === 'string' ? config : config.text;
      recorded.push({ text, params: params ?? [] });
      if (brokenBy !== undefined) throw brokenBy;
      for (const [key, error] of Object.entries(options.failOn ?? {})) {
        if (text.includes(key)) {
          if (options.broken === true) brokenBy = error;
          throw error;
        }
      }
      const rows = text.includes('admin_create_shop') ? [{ id: NEW_SHOP, admin_create_shop: NEW_SHOP }] : [];
      return { rows, rowCount: rows.length, command: 'SELECT', fields: [] };
    }),
    release: vi.fn(),
    // Un client di pg è un EventEmitter: l'implementazione può ascoltarne gli errori durante la transazione.
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  };
  const connect = vi.fn(async () => client);
  return { pool: { connect } as unknown as Pool, connect, client, recorded };
}

const SET_CONFIG = /set_config\(\s*'app\.(shop_id|user_id)'\s*,\s*\$(\d+)\s*,\s*true\s*\)/gi;

/** I valori con cui un'istruzione imposta app.shop_id e app.user_id: set_config con parametro e true (NEG-005). */
function contextOf(statement: Recorded): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const match of statement.text.matchAll(SET_CONFIG)) {
    values[match[1]!.toLowerCase()] = statement.params[Number(match[2]) - 1];
  }
  return values;
}

const indexOf = (recorded: Recorded[], predicate: (statement: Recorded) => boolean) => recorded.findIndex(predicate);
/** Il corpo di fn: un'istruzione riconoscibile dal testo (FN_MARKER è scritto nella query, non è un parametro). */
const fnBody = async (tx: Tx) => {
  await tx.execute(sql`SELECT 'corpo di fn' AS marker`);
};
const ctx = (overrides: Partial<ShopCtx> = {}): ShopCtx => ({
  shopId: SHOP,
  userId: USER,
  actor: 'user',
  ...overrides,
});

/** La rappresentazione di tutto quello che è passato per la connessione, per cercarvi valori fuori posto. */
const allTexts = (recorded: Recorded[]) => recorded.map((statement) => statement.text).join('\n');

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

/** La chiamata come promessa, anche se l'errore arriva in modo sincrono: il piano non sceglie fra le due forme. */
const attempt = (run: () => unknown): Promise<unknown> => (async () => run())();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('argomenti', () => {
  it('02§withShop: withShop rifiuta uno shopId che non ha la forma di un UUID, prima di prendere una connessione', async () => {
    const bad = ['', 'abc', `${SHOP}0`, SHOP.slice(1), ` ${SHOP}`, `${SHOP}'; --`, SHOP.replaceAll('-', '')];
    for (const shopId of bad) {
      const { pool, connect } = fakePool();
      const fn = vi.fn(async () => 1);
      await expect(
        attempt(() => createDbContext(pool).withShop(ctx({ shopId }), fn)),
        shopId,
      ).rejects.toThrow();
      expect(connect, shopId).not.toHaveBeenCalled();
      expect(fn, shopId).not.toHaveBeenCalled();
    }
  });

  it('02§withShop: withShop accetta un UUID anche in maiuscolo', async () => {
    const { pool, connect } = fakePool();
    await expect(createDbContext(pool).withShop(ctx({ shopId: SHOP.toUpperCase() }), async () => 'ok')).resolves.toBe(
      'ok',
    );
    expect(connect).toHaveBeenCalledOnce();
  });

  it('02§withShop: withUser rifiuta un utente vuoto e withNewShop un amministratore vuoto, prima di prendere una connessione', async () => {
    const { pool, connect } = fakePool();
    const fn = vi.fn(async () => 1);
    await expect(attempt(() => createDbContext(pool).withUser('', fn))).rejects.toThrow();
    await expect(
      attempt(() => createDbContext(pool).withNewShop({ name: 'Negozio', subdomain: 'negozio-nuovo' }, '', fn)),
    ).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('istruzioni mandate alla connessione', () => {
  it('NEG-005: withShop imposta app.shop_id e app.user_id con set_config, come parametri e con true, subito dopo begin, e chiude con commit', async () => {
    const { pool, client, recorded } = fakePool();
    await createDbContext(pool).withShop(ctx(), fnBody);
    expect(recorded[0]?.text).toMatch(READ_WRITE_BEGIN);
    expect(contextOf(recorded[1]!)).toEqual({ shop_id: SHOP, user_id: USER });
    expect(recorded[2]?.text).toContain(FN_MARKER);
    expect(recorded.at(-1)?.text).toBe('commit');
    expect(allTexts(recorded)).not.toContain(SHOP);
    expect(allTexts(recorded)).not.toContain(USER);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('NEG-005: withShop con userId nullo imposta app.user_id a stringa vuota, sempre come parametro', async () => {
    const { pool, recorded } = fakePool();
    await createDbContext(pool).withShop(ctx({ userId: null, actor: 'system' }), fnBody);
    expect(contextOf(recorded[1]!)).toEqual({ shop_id: SHOP, user_id: '' });
  });

  it('02§withShop: con readOnly la transazione si apre con begin read only, senza con begin', async () => {
    const readOnly = fakePool();
    await createDbContext(readOnly.pool).withShop(ctx({ readOnly: true }), fnBody);
    expect(readOnly.recorded[0]?.text).toBe('begin read only');
    expect(contextOf(readOnly.recorded[1]!)).toEqual({ shop_id: SHOP, user_id: USER });

    const readWrite = fakePool();
    await createDbContext(readWrite.pool).withShop(ctx({ readOnly: false }), fnBody);
    expect(readWrite.recorded[0]?.text).toMatch(READ_WRITE_BEGIN);
  });

  it('NEG-005: withUser imposta app.user_id e svuota app.shop_id, entrambi come parametri', async () => {
    const { pool, recorded } = fakePool();
    await createDbContext(pool).withUser(USER, fnBody);
    expect(recorded[0]?.text).toMatch(READ_WRITE_BEGIN);
    expect(contextOf(recorded[1]!)).toEqual({ shop_id: '', user_id: USER });
    expect(recorded.at(-1)?.text).toBe('commit');
    expect(allTexts(recorded)).not.toContain(USER);
  });

  it('NEG-005: withNewShop imposta l’utente, chiama admin_create_shop con i nove parametri, poi imposta il negozio e chiama fn, in quest’ordine', async () => {
    const input: NewShopInput = {
      name: 'Negozio Nuovo',
      subdomain: 'negozio-nuovo',
      legalName: 'Negozio Nuovo S.r.l.',
      vatNumber: '01234567890',
      taxCode: 'RSSMRA80A01H501U',
      sdiCode: '0000000',
      pec: 'negozio-nuovo@pec.example.it',
      address: { street: 'Via Roma 1', city: 'Milano', zip: '20100', province: 'MI', country: 'IT' },
      isTest: true,
    };
    const { pool, recorded } = fakePool();
    let received: string | undefined;
    const result = await createDbContext(pool).withNewShop(input, ADMIN, async (tx, shopId) => {
      received = shopId;
      await fnBody(tx);
      return 'fatto';
    });
    expect(result).toBe('fatto');
    expect(received).toBe(NEW_SHOP);

    const user = indexOf(recorded, (s) => contextOf(s).user_id === ADMIN);
    const create = indexOf(recorded, (s) => s.text.includes('admin_create_shop'));
    const shop = indexOf(recorded, (s) => contextOf(s).shop_id === NEW_SHOP);
    const body = indexOf(recorded, (s) => s.text.includes(FN_MARKER));
    expect(recorded[0]?.text).toMatch(READ_WRITE_BEGIN);
    expect([user, create, shop, body].every((index) => index > 0)).toBe(true);
    expect(user).toBeLessThan(create);
    expect(create).toBeLessThan(shop);
    expect(shop).toBeLessThan(body);
    // L'istruzione dell'utente non imposta un negozio (al più svuota app.shop_id).
    expect(contextOf(recorded[user]!)).toMatchObject({ user_id: ADMIN });
    expect([undefined, '']).toContain(contextOf(recorded[user]!).shop_id);
    expect(recorded.at(-1)?.text).toBe('commit');

    const params = recorded[create]!.params;
    expect(params).toHaveLength(9);
    expect(params.slice(0, 7)).toEqual([
      input.name,
      input.subdomain,
      input.legalName,
      input.vatNumber,
      input.taxCode,
      input.sdiCode,
      input.pec,
    ]);
    const address = params[7];
    expect(typeof address === 'string' ? JSON.parse(address) : address).toEqual(input.address);
    expect(params[8]).toBe(true);
    for (const value of [input.name, input.subdomain, input.legalName, input.taxCode, input.pec, ADMIN, NEW_SHOP]) {
      expect(allTexts(recorded)).not.toContain(value);
    }
  });

  it('02§withShop: withNewShop passa null per i dati fiscali e l’indirizzo assenti e false per isTest assente', async () => {
    const { pool, recorded } = fakePool();
    await createDbContext(pool).withNewShop({ name: 'Negozio Minimo', subdomain: 'negozio-minimo' }, ADMIN, fnBody);
    const create = recorded.find((s) => s.text.includes('admin_create_shop'));
    expect(create?.params).toEqual(['Negozio Minimo', 'negozio-minimo', null, null, null, null, null, null, false]);
  });
});

describe('revoca e rilascio della connessione', () => {
  it('NEG-005: dopo withShop il tx è revocato: usarlo solleva l’errore del proxy e non manda nulla alla connessione', async () => {
    const { pool, client, recorded } = fakePool();
    let leaked: Tx | undefined;
    await createDbContext(pool).withShop(ctx(), async (tx) => {
      leaked = tx;
    });
    const before = recorded.length;
    const error = await errorOf(leaked!.execute(sql`SELECT 1`));
    expect(rootCause(error)).toBeInstanceOf(TypeError);
    expect((rootCause(error) as Error).message).toMatch(/revoked/);
    expect(recorded).toHaveLength(before);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('02§withShop: un errore di fn esce invariato, la transazione si annulla e la connessione torna al pool', async () => {
    const { pool, client, recorded } = fakePool();
    const failure = new Error('errore di fn');
    let leaked: Tx | undefined;
    const error = await errorOf(
      createDbContext(pool).withShop(ctx(), async (tx) => {
        leaked = tx;
        throw failure;
      }),
    );
    expect(error).toBe(failure);
    expect(recorded.at(-1)?.text).toBe('rollback');
    expect(allTexts(recorded)).not.toContain('commit');
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBeFalsy();
    expect(rootCause(await errorOf(leaked!.execute(sql`SELECT 1`)))).toBeInstanceOf(TypeError);
  });

  it('02§withShop: se fallisce il rollback la connessione si distrugge (release con l’errore), anche con un codice SQLSTATE', async () => {
    const failures = [
      new Error('Connection terminated unexpectedly'),
      pgError('57P01', 'terminating connection due to administrator command'),
    ];
    for (const failure of failures) {
      const { pool, client } = fakePool({ failOn: { rollback: failure } });
      await errorOf(
        createDbContext(pool).withShop(ctx(), async () => {
          throw new Error('errore di fn');
        }),
      );
      expect(client.release, failure.message).toHaveBeenCalledOnce();
      expect(client.release.mock.calls[0]?.[0], failure.message).toBeInstanceOf(Error);
    }
  });

  it('02§withShop: un errore della connessione (senza SQLSTATE) distrugge la connessione anche se il rollback riesce', async () => {
    const lost = new Error('Connection terminated unexpectedly');
    const { pool, client, recorded } = fakePool({ failOn: { [FN_MARKER]: lost } });
    const error = await errorOf(createDbContext(pool).withShop(ctx(), fnBody));
    expect(error).toBe(lost);
    expect(recorded.at(-1)?.text).toBe('rollback');
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('02§withShop: se l’errore viene dalla connessione (senza SQLSTATE) la connessione si distrugge e l’errore esce senza parametri', async () => {
    const lost = new Error('Connection terminated unexpectedly');
    const { pool, client } = fakePool({ failOn: { [FN_MARKER]: lost }, broken: true });
    const error = await errorOf(createDbContext(pool).withShop(ctx(), fnBody));
    expect(error).toBe(lost);
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('02§withShop: la connessione si rilascia anche se fallisce il begin', async () => {
    const { pool, client } = fakePool({
      failOn: { begin: new Error('Connection terminated unexpectedly') },
      broken: true,
    });
    const fn = vi.fn(async () => 1);
    await errorOf(createDbContext(pool).withShop(ctx(), fn));
    expect(fn).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('errori del database', () => {
  it('00§4.2: withShop trasforma l’errore del database in DbError, senza query né parametri, e la connessione torna al pool', async () => {
    const check = pgError(
      '23514',
      'new row for relation "audit_log" violates check constraint "audit_log_actor_type_check"',
      {
        constraint: 'audit_log_actor_type_check',
        table: 'audit_log',
        detail: 'Failing row contains (valore-segreto).',
      },
    );
    const { pool, client } = fakePool({ failOn: { FAIL_HERE: check } });
    const error = await errorOf(
      createDbContext(pool).withShop(ctx(), async (tx) => {
        await tx.execute(sql`SELECT 'FAIL_HERE', ${'valore-segreto'}::text`);
      }),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '23514', constraint: 'audit_log_actor_type_check', table: 'audit_log' });
    const text = inspect(error, { depth: null });
    for (const value of ['valore-segreto', 'FAIL_HERE', 'Failed query', 'Failing row contains']) {
      expect(text).not.toContain(value);
    }
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBeFalsy();
  });
});

describe('importazione', () => {
  it('FON-002: context.ts, errors.ts e resolve-host.ts si importano senza DATABASE_URL e PUBLIC_BASE_DOMAIN, come durante next build, e leggono ambiente e pool alla prima chiamata', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('PUBLIC_BASE_DOMAIN', undefined);
    vi.resetModules();
    const context = await import('@/server/db/context');
    expect(context).toHaveProperty('withShop');
    await expect(import('@/server/db/errors')).resolves.toHaveProperty('DbError');
    const { resolveHost } = await import('@/server/db/resolve-host');

    // Dopo l'importazione: il dominio di base si legge alla prima chiamata (in minuscolo), e solo allora si chiede il
    // pool, che senza DATABASE_URL non nasce (client.ts). Un dominio letto all'importazione sarebbe vuoto, e l'host
    // non verrebbe nemmeno cercato.
    vi.stubEnv('PUBLIC_BASE_DOMAIN', 'Example.COM');
    await expect(attempt(() => resolveHost('negozio-a.example.com'))).rejects.toThrow(/DATABASE_URL/);
    await expect(attempt(() => context.withShop(ctx(), async () => 1))).rejects.toThrow(/DATABASE_URL/);
  });
});
