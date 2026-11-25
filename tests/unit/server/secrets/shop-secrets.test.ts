import { createCipheriv, createDecipheriv } from 'node:crypto';
import { inspect } from 'node:util';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDbContext, type ShopCtx } from '@/server/db/context';
import { createShopSecrets } from '@/server/secrets/shop-secrets';

// Segreti per negozio (02 §Segreti per negozio, NEG-014; NEG-T09, note (4) e (8) del piano; 00 R-DATI-10), senza
// database: createShopSecrets riceve una chiave data (il progetto `unit` non ha file di ambiente) e la withShop di
// createDbContext su un pool finto che registra testo e parametri di ogni istruzione che Drizzle manda alla connessione,
// compresi il `begin` e l'inserimento nel registro, e restituisce le righe scelte dal test per le istruzioni su
// shop_secrets. Così si vede che il valore in chiaro non arriva mai alla connessione: né come parametro (i parametri
// finirebbero nel messaggio di DrizzleQueryError, nei log e in Sentry) né nel testo, né nella riga del registro.

const SHOP_A = '0195f3c1-7a2b-7c3d-8e4f-5a6b7c8d9e0f';
const SHOP_B = '0195f3c1-7a2b-7c3d-8e4f-0000000000bb';
const USER = 'utente-neg-t09';
const SECRET = 'valore-segreto';
const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 8).toString('base64');

// I messaggi fissi della nota (4) del piano: non riportano mai il valore, il nome o la chiave ricevuti.
const AUTH_FAILED =
  'Segreto del negozio non decifrabile: chiave diversa, altro negozio o altro nome, oppure testo alterato.';
const BAD_FORMAT = 'Segreto del negozio in un formato sconosciuto.';
const BAD_NAME = 'Nome del segreto non valido.';
const BAD_VALUE = 'Il valore del segreto deve essere una stringa.';
const MISSING_KEY = 'Manca SHOP_SECRETS_KEY.';
const INVALID_KEY = 'SHOP_SECRETS_KEY non valida: servono 32 byte in base64.';

/** Una transazione in scrittura si apre con `begin` (o `begin read write`, che PostgreSQL tratta allo stesso modo). */
const READ_WRITE_BEGIN = /^begin(?: read write)?$/;

interface Recorded {
  text: string;
  params: unknown[];
}

/** Le righe che il pool finto restituisce alle istruzioni su shop_secrets. */
interface Rows {
  upsert?: Record<string, unknown>[];
  select?: Record<string, unknown>[];
  remove?: Record<string, unknown>[];
}

/** Il testo di un'istruzione senza virgolette doppie, con gli spazi ridotti e in minuscolo. */
const normalize = (text: string) => text.replaceAll('"', '').replace(/\s+/g, ' ').trim().toLowerCase();

const isUpsert = (statement: Recorded) => /^insert into (?:public\.)?shop_secrets\b/.test(normalize(statement.text));
const isSelect = (statement: Recorded) => /^select .* from (?:public\.)?shop_secrets\b/.test(normalize(statement.text));
const isDelete = (statement: Recorded) => /^delete from (?:public\.)?shop_secrets\b/.test(normalize(statement.text));
const isAudit = (statement: Recorded) => /^insert into (?:public\.)?audit_log\b/.test(normalize(statement.text));

/** Il tag di PostgreSQL per le istruzioni di transazione; alle altre il pool risponde come a una SELECT. */
function tagOf(text: string): string {
  if (/^begin\b/.test(text)) return 'BEGIN';
  if (text === 'commit') return 'COMMIT';
  if (text === 'rollback') return 'ROLLBACK';
  return 'SELECT';
}

function fakePool(rows: Rows = {}) {
  const recorded: Recorded[] = [];
  const client = {
    query: vi.fn(async (config: string | { text: string }, params?: unknown[]) => {
      const text = typeof config === 'string' ? config : config.text;
      const statement = { text, params: params ?? [] };
      recorded.push(statement);
      let result: Record<string, unknown>[] = [];
      if (isUpsert(statement)) result = rows.upsert ?? [{ rotated: false }];
      else if (isSelect(statement)) result = rows.select ?? [];
      else if (isDelete(statement)) result = rows.remove ?? [];
      return { rows: result, rowCount: result.length, command: tagOf(text), fields: [] };
    }),
    release: vi.fn(),
    getTransactionStatus: vi.fn(() => 'I'),
    // Un client di pg è un EventEmitter: context.ts ne ascolta gli errori durante la transazione.
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  };
  const connect = vi.fn(async () => client);
  return { pool: { connect } as unknown as Pool, connect, recorded };
}

/** Le funzioni dei segreti su un pool finto, con la chiave data (`null`: nessuna chiave, si legge SHOP_SECRETS_KEY). */
function secretsWith(rows: Rows = {}, key: string | null = KEY) {
  const { pool, connect, recorded } = fakePool(rows);
  const withShop = createDbContext(pool).withShop;
  const secrets = createShopSecrets(key === null ? { withShop } : { withShop, key });
  return { secrets, connect, recorded };
}

const ctx = (overrides: Partial<ShopCtx> = {}): ShopCtx => ({
  shopId: SHOP_A,
  userId: USER,
  actor: 'user',
  ...overrides,
});

/** Il testo cifrato che setShopSecret ha mandato alla connessione: l'unico Buffer fra i parametri dell'upsert. */
function savedCiphertext(recorded: Recorded[]): Buffer {
  const upserts = recorded.filter(isUpsert);
  expect(upserts).toHaveLength(1);
  const buffers = upserts[0]!.params.filter((param): param is Buffer => Buffer.isBuffer(param));
  expect(buffers).toHaveLength(1);
  return buffers[0]!;
}

/** Il testo cifrato di `value`, scritto per `shopId` e `name` con la chiave data. */
async function encrypted(value: string, shopId = SHOP_A, name = 'prova', key = KEY): Promise<Buffer> {
  const writer = secretsWith({}, key);
  await writer.secrets.setShopSecret(ctx({ shopId }), name, value);
  return savedCiphertext(writer.recorded);
}

/** Nessuna istruzione mandata alla connessione contiene il valore, né nel testo né nei parametri. */
function expectValueNeverSent(recorded: Recorded[], value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  for (const statement of recorded) {
    expect(statement.text, statement.text).not.toContain(value);
    for (const param of statement.params) {
      if (Buffer.isBuffer(param)) expect(param.includes(bytes), statement.text).toBe(false);
      else expect(inspect(param), statement.text).not.toContain(value);
    }
  }
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('La chiamata doveva fallire.');
}

/** Un errore dell'helper: il messaggio atteso, nessuna `cause`, e nessuna traccia dei valori in `util.inspect`. */
function expectFixedError(error: unknown, message: string, ...absent: string[]): void {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(message);
  expect(Object.hasOwn(error as object, 'cause')).toBe(false);
  for (const text of absent) expect(inspect(error)).not.toContain(text);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('cifratura e lettura', () => {
  it('NEG-014: setShopSecret manda alla connessione solo il testo cifrato (nonce di 12 byte, testo, tag di 16) e getShopSecret lo restituisce', async () => {
    for (const value of [SECRET, '', 'pàssword ✓ con spazi e "virgolette"']) {
      const saved = await encrypted(value);
      expect(saved.length).toBe(12 + Buffer.byteLength(value, 'utf8') + 16);
      if (value !== '') expect(saved.includes(Buffer.from(value, 'utf8'))).toBe(false);
      const reader = secretsWith({ select: [{ ciphertext: saved }] });
      await expect(reader.secrets.getShopSecret(ctx(), 'prova')).resolves.toBe(value);
    }
  });

  it('NEG-014: il testo cifrato è AES-256-GCM con la chiave, nel formato nonce di 12 byte ‖ testo cifrato ‖ tag di 16, con dati aggiuntivi autenticati `<shop_id>:<name>` in UTF-8, nei due sensi', async () => {
    const key = Buffer.from(KEY, 'base64');
    const aad = (shopId: string, name: string) => Buffer.from(`${shopId}:${name}`, 'utf8');
    const cases: [string, string, string][] = [
      [SECRET, SHOP_A, 'prova'],
      ['', SHOP_B, 'fiscale.fornitore.api_key'],
      ['pàssword ✓', SHOP_A, 'x'.repeat(64)],
    ];
    for (const [value, shopId, name] of cases) {
      // Dall'helper a node:crypto: il valore salvato si apre fuori dall'helper, nel formato della nota (4)(e), che è
      // quello che userà secrets:rotate-shop-key ricavando i dati autenticati dalla riga.
      const saved = await encrypted(value, shopId, name);
      const decipher = createDecipheriv('aes-256-gcm', key, saved.subarray(0, 12), { authTagLength: 16 });
      decipher.setAAD(aad(shopId, name));
      decipher.setAuthTag(saved.subarray(saved.length - 16));
      const opened = Buffer.concat([decipher.update(saved.subarray(12, saved.length - 16)), decipher.final()]);
      expect(opened.toString('utf8')).toBe(value);

      // Da node:crypto all'helper: un valore cifrato fuori dall'helper nello stesso formato, con un nonce fisso, si legge.
      const nonce = Buffer.alloc(12, 3);
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
      cipher.setAAD(aad(shopId, name));
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      const external = Buffer.concat([nonce, body, cipher.getAuthTag()]);
      const reader = secretsWith({ select: [{ ciphertext: external }] });
      await expect(reader.secrets.getShopSecret(ctx({ shopId }), name)).resolves.toBe(value);
    }
  });

  it('NEG-014: il valore in chiaro non è mai il testo né un parametro di un’istruzione, compreso l’inserimento nel registro', async () => {
    const writer = secretsWith();
    await writer.secrets.setShopSecret(ctx(), 'prova', SECRET);
    expectValueNeverSent(writer.recorded, SECRET);
    const upsert = writer.recorded.find(isUpsert)!;
    expect(upsert.params).toEqual(expect.arrayContaining([SHOP_A, 'prova']));
    const audits = writer.recorded.filter(isAudit);
    expect(audits).toHaveLength(1);
    // Nel registro solo chi agisce, l'azione, il tipo e il nome del segreto: niente valore, testo cifrato o hash.
    const allowed = new Set<unknown>(['user', 'shop_secret_set', 'shop_secret', 'prova', null]);
    for (const param of audits[0]!.params) expect(allowed.has(param), inspect(param)).toBe(true);
    expect(audits[0]!.params).toEqual(expect.arrayContaining(['user', 'shop_secret_set', 'shop_secret', 'prova']));

    const reader = secretsWith({ select: [{ ciphertext: savedCiphertext(writer.recorded) }] });
    await reader.secrets.getShopSecret(ctx(), 'prova');
    expectValueNeverSent(reader.recorded, SECRET);
    expect(reader.recorded.find(isSelect)!.params).toEqual(expect.arrayContaining([SHOP_A, 'prova']));
  });

  it('NEG-014: due scritture dello stesso valore hanno nonce e testo cifrato diversi', async () => {
    const first = await encrypted(SECRET);
    const second = await encrypted(SECRET);
    expect(first.subarray(0, 12).equals(second.subarray(0, 12))).toBe(false);
    expect(first.equals(second)).toBe(false);
  });

  it('NEG-014: il testo cifrato letto con un altro negozio, un altro nome o un’altra chiave non si decifra (autenticazione GCM fallita), con un messaggio fisso senza il valore', async () => {
    const saved = await encrypted(SECRET, SHOP_A, 'prova');
    const otherShop = secretsWith({ select: [{ ciphertext: saved }] });
    expectFixedError(
      await errorOf(otherShop.secrets.getShopSecret(ctx({ shopId: SHOP_B }), 'prova')),
      AUTH_FAILED,
      SECRET,
    );
    const otherName = secretsWith({ select: [{ ciphertext: saved }] });
    expectFixedError(await errorOf(otherName.secrets.getShopSecret(ctx(), 'altro')), AUTH_FAILED, SECRET);
    const otherKey = secretsWith({ select: [{ ciphertext: saved }] }, OTHER_KEY);
    expectFixedError(await errorOf(otherKey.secrets.getShopSecret(ctx(), 'prova')), AUTH_FAILED, SECRET);
    // Controllo positivo: lo stesso testo cifrato, con negozio, nome e chiave giusti, si legge.
    const same = secretsWith({ select: [{ ciphertext: saved }] });
    await expect(same.secrets.getShopSecret(ctx(), 'prova')).resolves.toBe(SECRET);
  });

  it('NEG-014: un testo cifrato con un byte alterato (nonce, testo o tag) o accorciato restando di almeno 28 byte non si decifra; sotto i 28 byte è un formato sconosciuto', async () => {
    const saved = await encrypted(SECRET);
    expect(saved.length).toBe(42);
    const altered = [0, 12, saved.length - 1].map((index) => {
      const copy = Buffer.from(saved);
      copy[index] = copy[index]! ^ 0x01;
      return copy;
    });
    const shortened = [1, 4, 14].map((bytes) => saved.subarray(0, saved.length - bytes));
    for (const ciphertext of [...altered, ...shortened]) {
      expect(ciphertext.length).toBeGreaterThanOrEqual(28);
      const reader = secretsWith({ select: [{ ciphertext }] });
      expectFixedError(await errorOf(reader.secrets.getShopSecret(ctx(), 'prova')), AUTH_FAILED, SECRET);
    }
    for (const ciphertext of [saved.subarray(0, 27), Buffer.alloc(0)]) {
      const reader = secretsWith({ select: [{ ciphertext }] });
      expectFixedError(await errorOf(reader.secrets.getShopSecret(ctx(), 'prova')), BAD_FORMAT);
    }
  });

  it('NEG-014: getShopSecret restituisce null se la riga non c’è', async () => {
    const reader = secretsWith({ select: [] });
    await expect(reader.secrets.getShopSecret(ctx(), 'prova')).resolves.toBeNull();
    expect(reader.recorded.some(isSelect)).toBe(true);
  });
});

describe('controlli prima della transazione', () => {
  it('NEG-014: con la chiave mancante, vuota o di lunghezza sbagliata getShopSecret e setShopSecret rifiutano senza prendere una connessione, con messaggi che nominano SHOP_SECRETS_KEY e non il valore', async () => {
    // [chiave esplicita (null: nessuna), SHOP_SECRETS_KEY dell'ambiente, messaggio atteso]
    const cases: [string | null, string | undefined, string][] = [
      ['', undefined, MISSING_KEY],
      [null, undefined, MISSING_KEY],
      [null, '', MISSING_KEY],
      [Buffer.alloc(16, 1).toString('base64'), undefined, INVALID_KEY],
      [null, Buffer.alloc(31, 1).toString('base64'), INVALID_KEY],
      [null, 'non-è-base64', INVALID_KEY],
    ];
    for (const [key, environment, message] of cases) {
      vi.stubEnv('SHOP_SECRETS_KEY', environment);
      const { secrets, connect } = secretsWith({}, key);
      expectFixedError(await errorOf(secrets.setShopSecret(ctx(), 'prova', SECRET)), message, SECRET);
      expectFixedError(await errorOf(secrets.getShopSecret(ctx(), 'prova')), message);
      expect(connect).not.toHaveBeenCalled();
    }
  });

  it('NEG-014: senza chiave esplicita si usa SHOP_SECRETS_KEY dell’ambiente, e deleteShopSecret non ha bisogno della chiave', async () => {
    vi.stubEnv('SHOP_SECRETS_KEY', KEY);
    const saved = await encrypted(SECRET, SHOP_A, 'prova', KEY);
    const reader = secretsWith({ select: [{ ciphertext: saved }] }, null);
    await expect(reader.secrets.getShopSecret(ctx(), 'prova')).resolves.toBe(SECRET);

    vi.stubEnv('SHOP_SECRETS_KEY', undefined);
    const remover = secretsWith({ remove: [] }, null);
    await expect(remover.secrets.deleteShopSecret(ctx(), 'prova')).resolves.toBe(false);
    expect(remover.connect).toHaveBeenCalledOnce();
  });

  it('NEG-014: un nome fuori formato o un valore che non è una stringa sono rifiutati senza prendere una connessione, con messaggi fissi', async () => {
    const badNames = [
      '',
      'Prova',
      'prova!',
      'a b',
      'a:b',
      'perché',
      'nome-con-trattino',
      'x'.repeat(65),
      'NOME-SBAGLIATO-X',
    ];
    for (const name of badNames) {
      const { secrets, connect } = secretsWith();
      expectFixedError(await errorOf(secrets.setShopSecret(ctx(), name, SECRET)), BAD_NAME, SECRET, 'NOME-SBAGLIATO');
      expectFixedError(await errorOf(secrets.getShopSecret(ctx(), name)), BAD_NAME, 'NOME-SBAGLIATO');
      expectFixedError(await errorOf(secrets.deleteShopSecret(ctx(), name)), BAD_NAME, 'NOME-SBAGLIATO');
      expect(connect).not.toHaveBeenCalled();
    }
    for (const value of [42, null, undefined, { valore: SECRET }, Buffer.from(SECRET)]) {
      const { secrets, connect } = secretsWith();
      const error = await errorOf(secrets.setShopSecret(ctx(), 'prova', value as unknown as string));
      expectFixedError(error, BAD_VALUE, SECRET);
      expect(connect).not.toHaveBeenCalled();
    }
    // I nomi validi ai bordi del formato passano (anche quelli del modulo cassa, 10 §6).
    for (const name of ['a', 'x'.repeat(64), 'fiscale.fornitore.api_key', '0.9_z']) {
      const { secrets, connect } = secretsWith();
      await secrets.setShopSecret(ctx(), name, SECRET);
      expect(connect).toHaveBeenCalledOnce();
    }
  });
});

describe('transazioni e registro', () => {
  it('NEG-014: getShopSecret apre una transazione in sola lettura; setShopSecret e deleteShopSecret passano readOnly com’è', async () => {
    const reader = secretsWith({ select: [] });
    await reader.secrets.getShopSecret(ctx({ readOnly: false }), 'prova');
    expect(reader.recorded[0]?.text).toBe('begin read only');

    for (const readOnly of [undefined, false, true]) {
      const writer = secretsWith();
      await writer.secrets.setShopSecret(ctx({ readOnly }), 'prova', SECRET);
      const remover = secretsWith({ remove: [] });
      await remover.secrets.deleteShopSecret(ctx({ readOnly }), 'prova');
      for (const { recorded } of [writer, remover]) {
        if (readOnly === true) expect(recorded[0]?.text).toBe('begin read only');
        else expect(recorded[0]?.text).toMatch(READ_WRITE_BEGIN);
      }
    }
  });

  it('NEG-014: l’upsert aggiorna solo ciphertext e rotated_at; una riga nuova scrive shop_secret_set e una riga che esisteva shop_secret_rotated, nella stessa transazione, con il solo nome', async () => {
    for (const [rotated, action] of [
      [false, 'shop_secret_set'],
      [true, 'shop_secret_rotated'],
    ] as const) {
      const writer = secretsWith({ upsert: [{ rotated }] });
      await writer.secrets.setShopSecret(ctx(), 'prova', SECRET);
      const upsert = writer.recorded.find(isUpsert)!;
      expect(normalize(upsert.text)).toMatch(
        /on conflict \(shop_id, ?name\) do update set ciphertext = excluded\.ciphertext, rotated_at = now\(\) returning \(rotated_at is not null\) as rotated$/,
      );
      const audits = writer.recorded.filter(isAudit);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.params).toEqual(expect.arrayContaining(['user', action, 'shop_secret', 'prova']));
      // Scrittura e registro nella stessa transazione (OPS-020): una connessione, un solo begin, il commit in fondo.
      const texts = writer.recorded.map((statement) => statement.text);
      expect(writer.connect).toHaveBeenCalledOnce();
      expect(texts.filter((text) => /^begin\b/.test(text))).toHaveLength(1);
      expect(texts.filter((text) => text === 'commit')).toHaveLength(1);
      expect(writer.recorded.indexOf(upsert)).toBeLessThan(writer.recorded.indexOf(audits[0]!));
      expect(texts.at(-1)).toBe('commit');
    }
  });

  it('NEG-014: deleteShopSecret scrive shop_secret_deleted e restituisce true solo se ha cancellato una riga', async () => {
    const remover = secretsWith({ remove: [{ id: '0195f3c1-7a2b-7c3d-8e4f-00000000dead' }] });
    await expect(remover.secrets.deleteShopSecret(ctx({ actor: 'system', userId: null }), 'prova')).resolves.toBe(true);
    const deletion = remover.recorded.find(isDelete)!;
    expect(normalize(deletion.text)).toMatch(/ returning id$/);
    expect(deletion.params).toEqual(expect.arrayContaining([SHOP_A, 'prova']));
    const audits = remover.recorded.filter(isAudit);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.params).toEqual(
      expect.arrayContaining(['system', 'shop_secret_deleted', 'shop_secret', 'prova']),
    );
    // Cancellazione e registro nella stessa transazione (OPS-020): una connessione, un solo begin, il commit in fondo.
    const texts = remover.recorded.map((statement) => statement.text);
    expect(remover.connect).toHaveBeenCalledOnce();
    expect(texts.filter((text) => /^begin\b/.test(text))).toHaveLength(1);
    expect(texts.filter((text) => text === 'commit')).toHaveLength(1);
    expect(remover.recorded.indexOf(deletion)).toBeLessThan(remover.recorded.indexOf(audits[0]!));
    expect(texts.at(-1)).toBe('commit');

    const nothing = secretsWith({ remove: [] });
    await expect(nothing.secrets.deleteShopSecret(ctx(), 'prova')).resolves.toBe(false);
    expect(nothing.recorded.some(isDelete)).toBe(true);
    expect(nothing.recorded.some(isAudit)).toBe(false);
  });
});

describe('importazione', () => {
  it('FON-002: shop-secrets.ts si importa senza SHOP_SECRETS_KEY né DATABASE_URL, e legge la chiave a ogni chiamata, prima di chiedere il pool', async () => {
    vi.stubEnv('SHOP_SECRETS_KEY', undefined);
    vi.stubEnv('DATABASE_URL', undefined);
    vi.resetModules();
    const secrets = await import('@/server/secrets/shop-secrets');
    expectFixedError(await errorOf(secrets.getShopSecret(ctx(), 'prova')), MISSING_KEY);
    expectFixedError(await errorOf(secrets.setShopSecret(ctx(), 'prova', SECRET)), MISSING_KEY, SECRET);

    // La chiave messa dopo l'importazione vale: la chiamata arriva fino al pool, che senza DATABASE_URL non nasce.
    vi.stubEnv('SHOP_SECRETS_KEY', KEY);
    await expect(secrets.getShopSecret(ctx(), 'prova')).rejects.toThrow('Manca DATABASE_URL.');
    await expect(secrets.setShopSecret(ctx(), 'prova', SECRET)).rejects.toThrow('Manca DATABASE_URL.');
    // E si rilegge alla chiamata dopo: tolta dall'ambiente, manca di nuovo (nessuna copia tenuta dal modulo).
    vi.stubEnv('SHOP_SECRETS_KEY', undefined);
    expectFixedError(await errorOf(secrets.getShopSecret(ctx(), 'prova')), MISSING_KEY);
    expectFixedError(await errorOf(secrets.setShopSecret(ctx(), 'prova', SECRET)), MISSING_KEY, SECRET);
    await expect(secrets.deleteShopSecret(ctx(), 'prova')).rejects.toThrow('Manca DATABASE_URL.');

    // Cifratura e decifratura restano interne al file (nota (4)(b)): il modulo esporta solo queste funzioni.
    const exported = Object.entries(secrets)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual(['createShopSecrets', 'deleteShopSecret', 'getShopSecret', 'setShopSecret']);
  });
});
