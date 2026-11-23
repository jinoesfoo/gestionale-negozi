import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { sql } from 'drizzle-orm';
import { DatabaseError, type Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDbContext, type DbContext, type NewShopInput, type ShopCtx, type Tx } from '@/server/db/context';
import { DbError } from '@/server/db/errors';

// 02 §withShop e NEG-T02, note (1), (2), (8)(b), (10), (11) e (18) del piano: prove senza database, su un pool finto
// che registra testo e parametri di ogni istruzione che Drizzle manda alla connessione. createDbContext(pool) prende una
// connessione con pool.connect(), la usa per una sola transazione e alla fine la rilascia (release), revocandone l'uso.

const SHOP = '0195f3c1-7a2b-7c3d-8e4f-5a6b7c8d9e0f';
const NEW_SHOP = '0195f3c1-7a2b-7c3d-8e4f-0000000000aa';
const USER = 'utente-neg-t02';
const ADMIN = 'admin-neg-t02';
const FN_MARKER = 'corpo di fn';
const SECRET = 'valore-segreto';

interface Recorded {
  text: string;
  params: unknown[];
}

interface FakeOptions {
  /** Errore da sollevare per l'istruzione il cui testo contiene la chiave. */
  failOn?: Record<string, Error>;
  /** Dopo il primo errore di failOn, ogni istruzione successiva fallisce con lo stesso errore (connessione persa). */
  broken?: boolean;
  /** Il valore di getTransactionStatus() della connessione (pg 8.23.1): 'I' inattiva, 'T' in transazione, 'E' fallita. */
  status?: string;
  /** Il tag con cui risponde il commit: 'ROLLBACK' se la transazione era fallita (nota (10)(a)). */
  commitTag?: string;
  /** L'id che restituisce admin_create_shop (null: la funzione non ha restituito il negozio). */
  createdId?: string | null;
}

/** Il DatabaseError di pg: messaggio di PostgreSQL, codice SQLSTATE, gravità e campi separati. */
function pgError(code: string, message: string, fields: Record<string, string> = {}): Error {
  return Object.assign(new DatabaseError(message, 0, 'error'), { severity: 'ERROR', code, ...fields });
}

/** Il tag di PostgreSQL per le istruzioni di transazione; ogni altra istruzione dei test è una SELECT. */
function tagOf(text: string, commitTag = 'COMMIT'): string {
  if (/^begin\b/.test(text)) return 'BEGIN';
  if (text === 'commit') return commitTag;
  if (text === 'rollback') return 'ROLLBACK';
  return 'SELECT';
}

/** Una transazione in scrittura si apre con `begin` (o `begin read write`, che PostgreSQL tratta allo stesso modo). */
const READ_WRITE_BEGIN = /^begin(?: read write)?$/;

function fakePool(options: FakeOptions = {}) {
  const recorded: Recorded[] = [];
  let brokenBy: Error | undefined;
  const createdId = options.createdId === undefined ? NEW_SHOP : options.createdId;
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
      const rows = text.includes('admin_create_shop') ? [{ id: createdId, admin_create_shop: createdId }] : [];
      return { rows, rowCount: rows.length, command: tagOf(text, options.commitTag), fields: [] };
    }),
    release: vi.fn(),
    getTransactionStatus: vi.fn(() => options.status ?? 'I'),
    // Un client di pg è un EventEmitter: l'implementazione ne ascolta gli errori durante la transazione.
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  };
  const connect = vi.fn(async () => client);
  return { pool: { connect } as unknown as Pool, connect, client, recorded };
}

/**
 * Un client finto che è un EventEmitter vero, come quello di pg: senza ascoltatori `emit('error')` lancia. `respond`
 * può sollevare un errore o restituire un risultato; se restituisce undefined la risposta è quella normale.
 */
function emitterPool(respond: (text: string, client: EventEmitter) => unknown) {
  const recorded: string[] = [];
  const emitter = new EventEmitter();
  const client = Object.assign(emitter, {
    query: vi.fn(async (config: string | { text: string }) => {
      const text = typeof config === 'string' ? config : config.text;
      recorded.push(text);
      const custom = await respond(text, emitter);
      return custom ?? { rows: [], rowCount: 0, command: tagOf(text), fields: [] };
    }),
    release: vi.fn(),
    getTransactionStatus: vi.fn(() => 'I'),
  });
  return { pool: { connect: vi.fn(async () => client) } as unknown as Pool, client, recorded };
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
const NEW_INPUT: NewShopInput = { name: 'Negozio', subdomain: 'negozio-nuovo' };

/** La rappresentazione di tutto quello che è passato per la connessione, per cercarvi valori fuori posto. */
const allTexts = (recorded: Recorded[]) => recorded.map((statement) => statement.text).join('\n');

async function errorOf(promise: unknown, label = 'la chiamata'): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error(`${label} doveva fallire`);
}

function rootCause(error: unknown): unknown {
  let current = error;
  while (current instanceof Error && current.cause !== undefined) current = current.cause;
  return current;
}

/**
 * La chiamata non lancia in modo sincrono e restituisce una promessa (nota (10)(c): un argomento sbagliato dà sempre una
 * promessa rifiutata, mai un'eccezione sincrona).
 */
function asPromise(run: () => unknown): Promise<unknown> {
  let result: unknown;
  expect(() => {
    result = run();
  }).not.toThrow();
  expect(result).toBeInstanceOf(Promise);
  return result as Promise<unknown>;
}

/** La connessione si è distrutta: release con un errore nuovo, che non è l'errore uscito e non porta query né valori. */
function expectDiscarded(release: ReturnType<typeof vi.fn>, error?: unknown): void {
  expect(release).toHaveBeenCalledOnce();
  const argument: unknown = release.mock.calls[0]?.[0];
  expect(argument).toBeInstanceOf(Error);
  if (error !== undefined) expect(argument).not.toBe(error);
  const text = inspect(argument, { depth: null });
  for (const value of ['Failed query', 'params:', FN_MARKER, SHOP, USER, SECRET]) expect(text).not.toContain(value);
}

/** La connessione è tornata al pool: release senza argomenti. */
function expectReturned(release: ReturnType<typeof vi.fn>): void {
  expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0]?.[0]).toBeFalsy();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@/server/db/client');
  vi.resetModules();
});

describe('argomenti', () => {
  it('02§withShop: withShop rifiuta uno shopId che non ha la forma di un UUID, prima di prendere una connessione', async () => {
    const bad = ['', 'abc', `${SHOP}0`, SHOP.slice(1), ` ${SHOP}`, `${SHOP}'; --`, SHOP.replaceAll('-', '')];
    for (const shopId of bad) {
      const { pool, connect } = fakePool();
      const fn = vi.fn(async () => 1);
      await expect(
        asPromise(() => createDbContext(pool).withShop(ctx({ shopId }), fn)),
        shopId,
      ).rejects.toThrow();
      expect(connect, shopId).not.toHaveBeenCalled();
      expect(fn, shopId).not.toHaveBeenCalled();
    }
  });

  it('02§withShop: withShop rifiuta uno shopId con lettere maiuscole (un UUID si accetta solo in minuscolo, come lo restituisce PostgreSQL)', async () => {
    for (const shopId of [SHOP.toUpperCase(), `${SHOP.slice(0, 30)}${SHOP.slice(30).toUpperCase()}`]) {
      const { pool, connect } = fakePool();
      const fn = vi.fn(async () => 1);
      await expect(
        asPromise(() => createDbContext(pool).withShop(ctx({ shopId }), fn)),
        shopId,
      ).rejects.toThrow();
      expect(connect, shopId).not.toHaveBeenCalled();
      expect(fn, shopId).not.toHaveBeenCalled();
    }
  });

  it('02§withShop: withShop rifiuta un userId vuoto, che farebbe passare l’azione di un utente per un lavoro di sistema', async () => {
    const { pool, connect } = fakePool();
    const fn = vi.fn(async () => 1);
    await expect(asPromise(() => createDbContext(pool).withShop(ctx({ userId: '' }), fn))).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it('02§withShop: withUser rifiuta un utente vuoto e withNewShop un amministratore vuoto, prima di prendere una connessione', async () => {
    const { pool, connect } = fakePool();
    const fn = vi.fn(async () => 1);
    await expect(asPromise(() => createDbContext(pool).withUser('', fn))).rejects.toThrow();
    await expect(asPromise(() => createDbContext(pool).withNewShop(NEW_INPUT, '', fn))).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it('02§withShop: i valori che non sono stringhe si rifiutano senza prendere una connessione; userId nullo di withShop resta il lavoro di sistema', async () => {
    const notText = (value: unknown) => value as string;
    const calls: [label: string, run: (context: DbContext, fn: () => Promise<number>) => unknown][] = [];
    for (const value of [123, null, undefined]) {
      calls.push([`shopId ${String(value)}`, (c, fn) => c.withShop(ctx({ shopId: notText(value) }), fn)]);
      calls.push([`userId di withUser ${String(value)}`, (c, fn) => c.withUser(notText(value), fn)]);
      calls.push([`adminId ${String(value)}`, (c, fn) => c.withNewShop(NEW_INPUT, notText(value), fn)]);
    }
    for (const value of [123, undefined]) {
      calls.push([`userId di withShop ${String(value)}`, (c, fn) => c.withShop(ctx({ userId: notText(value) }), fn)]);
    }
    for (const [label, run] of calls) {
      const { pool, connect } = fakePool();
      const fn = vi.fn(async () => 1);
      await expect(
        asPromise(() => run(createDbContext(pool), fn)),
        label,
      ).rejects.toThrow();
      expect(connect, label).not.toHaveBeenCalled();
      expect(fn, label).not.toHaveBeenCalled();
    }

    const { pool, connect } = fakePool();
    await expect(
      createDbContext(pool).withShop(ctx({ userId: null, actor: 'system' }), async () => 'ok'),
    ).resolves.toBe('ok');
    expect(connect).toHaveBeenCalledOnce();
  });

  it('00§4.2: l’errore di un argomento sbagliato ha un messaggio fisso, senza il valore ricevuto', async () => {
    const { pool } = fakePool();
    const context = createDbContext(pool);
    const email = 'mario.rossi@example.com';
    const cases: [value: string, run: () => unknown][] = [
      [email, () => context.withShop(ctx({ shopId: email }), async () => 1)],
      [SHOP.toUpperCase(), () => context.withShop(ctx({ shopId: SHOP.toUpperCase() }), async () => 1)],
    ];
    for (const [value, run] of cases) {
      const error = await errorOf(asPromise(run), value);
      expect(error, value).toBeInstanceOf(Error);
      expect(inspect(error, { depth: null }), value).not.toContain(value);
    }
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
    expectReturned(client.release);
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

  it('NEG-005: withNewShop svuota il negozio e imposta l’utente, chiama admin_create_shop con i nove parametri, poi imposta il negozio e chiama fn, in quest’ordine', async () => {
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
    expect(user).toBe(1);
    expect(user).toBeLessThan(create);
    expect(create).toBeLessThan(shop);
    expect(shop).toBeLessThan(body);
    // La prima istruzione è quella di withUser: svuota app.shop_id e imposta l'amministratore (nota (1)).
    expect(contextOf(recorded[user]!)).toEqual({ shop_id: '', user_id: ADMIN });
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

  it('02§withShop: se admin_create_shop non restituisce il negozio withNewShop fallisce senza impostarlo né chiamare fn, e la transazione si annulla', async () => {
    const { pool, client, recorded } = fakePool({ createdId: null });
    const fn = vi.fn(async () => 1);
    const error = await errorOf(createDbContext(pool).withNewShop(NEW_INPUT, ADMIN, fn));
    expect(error).toBeInstanceOf(Error);
    expect(fn).not.toHaveBeenCalled();
    const setsShop = recorded.some((statement) => {
      const shop = contextOf(statement).shop_id;
      return shop !== undefined && shop !== '';
    });
    expect(setsShop).toBe(false);
    expect(recorded.at(-1)?.text).toBe('rollback');
    expectReturned(client.release);
  });
});

describe('commit diventato rollback', () => {
  it('02§withShop: se il commit risponde ROLLBACK (fn ha intercettato un errore senza savepoint) la promessa è rifiutata e la connessione torna al pool', async () => {
    const body = async (tx: Tx) => {
      await fnBody(tx);
      return 'risultato di fn';
    };
    const runs: [label: string, run: (context: DbContext) => Promise<unknown>][] = [
      ['withShop', (c) => c.withShop(ctx(), body)],
      ['withUser', (c) => c.withUser(USER, body)],
      ['withNewShop', (c) => c.withNewShop(NEW_INPUT, ADMIN, body)],
    ];
    for (const [label, run] of runs) {
      const { pool, client } = fakePool({ commitTag: 'ROLLBACK' });
      const error = await errorOf(run(createDbContext(pool)), label);
      expect(error, label).toBeInstanceOf(Error);
      expect((error as Error).message, label).toMatch(/nulla è stato salvato/);
      const text = inspect(error, { depth: null });
      for (const value of [SHOP, USER, ADMIN, NEW_SHOP, 'risultato di fn']) expect(text, label).not.toContain(value);
      expectReturned(client.release);
    }
  });

  it('02§withShop: con il commit che risponde COMMIT la promessa si risolve con il risultato di fn', async () => {
    const { pool } = fakePool({ commitTag: 'COMMIT' });
    await expect(createDbContext(pool).withShop(ctx(), async () => 'salvato')).resolves.toBe('salvato');
  });
});

describe('annidamento', () => {
  it('02§withShop: withShop, withUser e withNewShop dentro fn di un’altra sono rifiutate senza prendere una seconda connessione', async () => {
    const nested: [label: string, run: (context: DbContext) => Promise<unknown>][] = [
      ['withShop in withShop', (c) => c.withShop(ctx(), () => errorOf(c.withShop(ctx(), async () => 1)))],
      ['withUser in withShop', (c) => c.withShop(ctx(), () => errorOf(c.withUser(USER, async () => 1)))],
      [
        'withShop in withNewShop',
        (c) => c.withNewShop(NEW_INPUT, ADMIN, () => errorOf(c.withShop(ctx(), async () => 1))),
      ],
    ];
    for (const [label, run] of nested) {
      const { pool, connect } = fakePool();
      const inner = await run(createDbContext(pool));
      expect(inner, label).toBeInstanceOf(Error);
      expect(connect, label).toHaveBeenCalledOnce();
    }
  });

  it('02§withShop: l’annidamento si rifiuta anche fra due contesti su pool diversi, senza connect sul secondo pool', async () => {
    const first = fakePool();
    const second = fakePool();
    const inner = await createDbContext(first.pool).withShop(ctx(), () =>
      errorOf(createDbContext(second.pool).withShop(ctx(), async () => 1)),
    );
    expect(inner).toBeInstanceOf(Error);
    expect(first.connect).toHaveBeenCalledOnce();
    expect(second.connect).not.toHaveBeenCalled();
  });

  it('02§withShop: l’annidamento si rifiuta anche fra le funzioni esportate, che creano un contesto nuovo a ogni chiamata', async () => {
    const { pool, connect } = fakePool();
    vi.doMock('@/server/db/client', () => ({ getPool: () => pool }));
    vi.resetModules();
    const context = await import('@/server/db/context');
    const inner = await context.withShop(ctx(), () => errorOf(context.withShop(ctx(), async () => 1)));
    expect(inner).toBeInstanceOf(Error);
    const innerUser = await context.withShop(ctx(), () => errorOf(context.withUser(USER, async () => 1)));
    expect(innerUser).toBeInstanceOf(Error);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('02§withShop: una chiamata avviata dentro fn ma eseguita dopo la fine della transazione (da un timer o da una promessa non attesa) è ammessa', async () => {
    const { pool, connect } = fakePool();
    const context = createDbContext(pool);
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let later: Promise<unknown> | undefined;
    await context.withShop(ctx(), async (tx) => {
      later = gate.then(() => context.withShop(ctx(), async () => 'dopo la fine'));
      await fnBody(tx);
    });
    openGate();
    await expect(later).resolves.toBe('dopo la fine');
    expect(connect).toHaveBeenCalledTimes(2);
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
    expectReturned(client.release);
  });

  it('02§withShop: il tx revocato di una chiamata precedente usato in fn senza intercettarlo fa uscire il TypeError del proxy, senza query né parametri, e la connessione si distrugge', async () => {
    const { pool, client } = fakePool();
    const context = createDbContext(pool);
    let leaked: Tx | undefined;
    await context.withShop(ctx(), async (tx) => {
      leaked = tx;
    });
    client.release.mockClear();
    const error = await errorOf(
      context.withShop(ctx(), async () => {
        await leaked!.execute(sql`SELECT ${SECRET}::text AS valore`);
      }),
    );
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/revoked/);
    const text = inspect(error, { depth: null });
    for (const value of ['Failed query', 'params:', SECRET]) expect(text).not.toContain(value);
    expectDiscarded(client.release, error);
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
    expectReturned(client.release);
    expect(rootCause(await errorOf(leaked!.execute(sql`SELECT 1`)))).toBeInstanceOf(TypeError);
  });

  it('02§withShop: se fallisce il rollback esce l’errore del rollback, mai quello di fn, e la connessione si distrugge, anche con un codice SQLSTATE', async () => {
    const lost = new Error('Connection terminated unexpectedly');
    const terminated = pgError('57P01', 'terminating connection due to administrator command');
    for (const failure of [lost, terminated]) {
      const { pool, client } = fakePool({ failOn: { rollback: failure } });
      const error = await errorOf(
        createDbContext(pool).withShop(ctx(), async () => {
          throw new Error('errore di fn');
        }),
      );
      if (failure === lost) {
        expect(error).toBe(lost);
      } else {
        expect(error).toBeInstanceOf(DbError);
        expect(error).toMatchObject({ code: '57P01', message: 'Errore del database (codice 57P01).' });
      }
      expect((error as Error).message).not.toBe('errore di fn');
      expectDiscarded(client.release, error);
    }
  });

  it('02§withShop: un errore della connessione (senza SQLSTATE) distrugge la connessione anche se il rollback riesce', async () => {
    const lost = new Error('Connection terminated unexpectedly');
    const { pool, client, recorded } = fakePool({ failOn: { [FN_MARKER]: lost } });
    const error = await errorOf(createDbContext(pool).withShop(ctx(), fnBody));
    expect(error).toBe(lost);
    expect(recorded.at(-1)?.text).toBe('rollback');
    expectDiscarded(client.release, error);
  });

  it('02§withShop: se l’errore viene dalla connessione (senza SQLSTATE) la connessione si distrugge e l’errore esce senza parametri', async () => {
    const lost = new Error('Connection terminated unexpectedly');
    const { pool, client } = fakePool({ failOn: { [FN_MARKER]: lost }, broken: true });
    const error = await errorOf(createDbContext(pool).withShop(ctx(), fnBody));
    expect(error).toBe(lost);
    expectDiscarded(client.release, error);
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

  it('02§withShop: un errore FATAL sul begin esce come DbError con il messaggio generico, fn non si chiama e la connessione torna al pool', async () => {
    const fatal = pgError('57P01', 'terminating connection due to administrator command', { severity: 'FATAL' });
    const { pool, client } = fakePool({ failOn: { begin: fatal } });
    const fn = vi.fn(async () => 1);
    const error = await errorOf(createDbContext(pool).withShop(ctx(), fn));
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '57P01', message: 'Errore del database (codice 57P01).' });
    expect(fn).not.toHaveBeenCalled();
    expectReturned(client.release);
  });

  it('02§withShop: un commit fallito con un codice SQLSTATE esce come DbError e la connessione torna al pool; senza codice esce l’errore della connessione e la connessione si distrugge', async () => {
    const serialization = pgError('40001', 'could not serialize access due to concurrent update');
    const withCode = fakePool({ failOn: { commit: serialization } });
    const coded = await errorOf(createDbContext(withCode.pool).withShop(ctx(), fnBody));
    expect(coded).toBeInstanceOf(DbError);
    expect(coded).toMatchObject({ code: '40001' });
    expect(withCode.recorded.slice(-2).map((statement) => statement.text)).toEqual(['commit', 'rollback']);
    expectReturned(withCode.client.release);

    const lost = new Error('Connection terminated unexpectedly');
    const withoutCode = fakePool({ failOn: { commit: lost }, broken: true });
    const uncoded = await errorOf(createDbContext(withoutCode.pool).withShop(ctx(), fnBody));
    expect(uncoded).toBe(lost);
    expectDiscarded(withoutCode.client.release, uncoded);
  });

  it('02§withShop: una connessione che esce dal pool non inattiva (in transazione o in una transazione fallita) si distrugge, senza begin e senza fn', async () => {
    for (const status of ['T', 'E']) {
      const { pool, client, recorded } = fakePool({ status });
      const fn = vi.fn(async () => 1);
      const error = await errorOf(createDbContext(pool).withShop(ctx(), fn), status);
      expect(error, status).toBeInstanceOf(Error);
      expect(recorded, status).toHaveLength(0);
      expect(fn, status).not.toHaveBeenCalled();
      expectDiscarded(client.release);
    }
  });
});

describe('errori della connessione fuori dal pool', () => {
  it('02§withShop: l’evento error della connessione dentro fn non termina il processo, e la connessione si distrugge', async () => {
    const { pool, client } = emitterPool(() => undefined);
    let threw = false;
    await createDbContext(pool).withShop(ctx(), async (tx) => {
      await fnBody(tx);
      try {
        client.emit('error', new Error('Connection terminated unexpectedly'));
      } catch {
        threw = true;
      }
      await tx.execute(sql`SELECT 2 AS dopo`);
    });
    expect(threw).toBe(false);
    expectDiscarded(client.release);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('02§withShop: l’evento error durante una query in attesa, che poi fallisce come in pg insieme al rollback, dà una promessa rifiutata e distrugge la connessione', async () => {
    const lost = new Error('Connection terminated unexpectedly');
    const notQueryable = new Error('Client has encountered a connection error and is not queryable');
    let threw = false;
    const { pool, client } = emitterPool((text, emitter) => {
      if (text.includes(FN_MARKER)) {
        try {
          emitter.emit('error', lost);
        } catch {
          threw = true;
        }
        throw lost;
      }
      if (text === 'rollback') throw notQueryable;
      return undefined;
    });
    const error = await errorOf(createDbContext(pool).withShop(ctx(), fnBody));
    expect(threw).toBe(false);
    expect(error).toBeInstanceOf(Error);
    expectDiscarded(client.release, error);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('02§withShop: dopo una chiamata riuscita la connessione non conserva l’ascoltatore di error', async () => {
    const { pool, client } = emitterPool(() => undefined);
    await createDbContext(pool).withShop(ctx(), fnBody);
    expect(client.listenerCount('error')).toBe(0);
    expectReturned(client.release);
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
        detail: `Failing row contains (${SECRET}).`,
      },
    );
    const { pool, client } = fakePool({ failOn: { FAIL_HERE: check } });
    const error = await errorOf(
      createDbContext(pool).withShop(ctx(), async (tx) => {
        await tx.execute(sql`SELECT 'FAIL_HERE', ${SECRET}::text`);
      }),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '23514', constraint: 'audit_log_actor_type_check', table: 'audit_log' });
    const text = inspect(error, { depth: null });
    for (const value of [SECRET, 'FAIL_HERE', 'Failed query', 'Failing row contains']) {
      expect(text).not.toContain(value);
    }
    expectReturned(client.release);
  });

  it('00§4.2: un errore di pool.connect() esce come DbError con il messaggio generico se viene dal server, invariato se è il tempo scaduto di pg-pool, e fn non si chiama', async () => {
    const tooMany = pgError('53300', 'sorry, too many clients already', { severity: 'FATAL' });
    const timeout = new Error('timeout exceeded when trying to connect');
    for (const failure of [tooMany, timeout]) {
      const connect = vi.fn(async () => {
        throw failure;
      });
      const fn = vi.fn(async () => 1);
      const error = await errorOf(createDbContext({ connect } as unknown as Pool).withShop(ctx(), fn), failure.message);
      if (failure === timeout) {
        expect(error).toBe(timeout);
      } else {
        expect(error).toBeInstanceOf(DbError);
        expect(error).toMatchObject({ code: '53300', message: 'Errore del database (codice 53300).' });
      }
      expect(fn).not.toHaveBeenCalled();
    }
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
    await expect(resolveHost('negozio-a.example.com')).rejects.toThrow(/DATABASE_URL/);
    await expect(asPromise(() => context.withShop(ctx(), async () => 1))).rejects.toThrow(/DATABASE_URL/);
  });

  it('FON-002: resolveHost chiede il pool solo per un host da cercare, a ogni ricerca, e l’errore non entra in cache', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('PUBLIC_BASE_DOMAIN', 'Example.COM');
    vi.resetModules();
    const { resolveHost } = await import('@/server/db/resolve-host');
    // Host scartati: null senza chiedere il pool (che senza DATABASE_URL solleverebbe).
    await expect(resolveHost('example.com')).resolves.toBeNull();
    await expect(resolveHost('127.0.0.1')).resolves.toBeNull();
    // Un host da cercare chiede il pool a ogni ricerca: lo stesso errore due volte di seguito.
    await expect(resolveHost('negozio-a.example.com')).rejects.toThrow(/DATABASE_URL/);
    await expect(resolveHost('negozio-a.example.com')).rejects.toThrow(/DATABASE_URL/);
  });

  it('FON-002: senza PUBLIC_BASE_DOMAIN resolveHost fallisce per ogni host senza creare il risolutore, poi tiene il dominio letto la prima volta', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('PUBLIC_BASE_DOMAIN', undefined);
    vi.resetModules();
    const { resolveHost } = await import('@/server/db/resolve-host');
    await expect(resolveHost('negozio-a.example.com')).rejects.toThrow(/PUBLIC_BASE_DOMAIN/);
    await expect(resolveHost('example.com')).rejects.toThrow(/PUBLIC_BASE_DOMAIN/);
    vi.stubEnv('PUBLIC_BASE_DOMAIN', '');
    await expect(resolveHost('negozio-a.example.com')).rejects.toThrow(/PUBLIC_BASE_DOMAIN/);

    // Con la variabile, la chiamata successiva crea il risolutore e arriva al pool.
    vi.stubEnv('PUBLIC_BASE_DOMAIN', 'example.com');
    await expect(resolveHost('negozio-a.example.com')).rejects.toThrow(/DATABASE_URL/);
    // Creato il risolutore, il dominio resta quello letto allora.
    vi.stubEnv('PUBLIC_BASE_DOMAIN', 'altro.example');
    await expect(resolveHost('negozio-a.altro.example')).resolves.toBeNull();
  });
});
