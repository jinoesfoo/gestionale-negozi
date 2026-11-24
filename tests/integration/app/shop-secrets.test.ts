import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/server/db/client';
import type { ShopCtx } from '@/server/db/context';
import { DbError } from '@/server/db/errors';
import { SHOP_DATA_FIXTURES } from '@/server/db/isolation/fixtures';
import { EXPORT_EXCLUDED_COLUMNS } from '@/server/exports/redact';
import { deleteShopSecret, getShopSecret, setShopSecret } from '@/server/secrets/shop-secrets';
import { closeRolePools, rolePool } from '../../fixtures/db';

// Segreti per negozio con il database vero (02 §Segreti per negozio, NEG-014; NEG-T09, note (2), (4), (5) e (8) del
// piano; 00 R-DATI-10, §6 per il permesso per colonna; 08 OPS-020): le funzioni esportate di
// src/server/secrets/shop-secrets.ts girano con DATABASE_URL = app_user (progetto int-app) e la chiave di prova
// SHOP_SECRETS_KEY di .env.test. I negozi li crea il proprietario, con sottodomini propri (i file di integrazione girano
// in parallelo sullo stesso database, che è anche quello di sviluppo), e li cancella per id alla fine: segreti e righe
// di registro seguono con ON DELETE CASCADE. Ogni controllo del registro guarda solo il negozio del test.

const SECRET = 'valore-segreto';
const USER_A = 'utente-a-neg-t09';
const USER_B = 'utente-b-neg-t09';
const AUTH_FAILED =
  'Segreto del negozio non decifrabile: chiave diversa, altro negozio o altro nome, oppure testo alterato.';

const owner = () => rolePool('owner');
const created: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  if (created.length > 0) {
    await owner().query('DELETE FROM public.shops WHERE id = ANY($1::uuid[])', [created]);
  }
  await closeDb();
  await closeRolePools();
});

/** Un negozio `trial` creato dal proprietario e cancellato alla fine. */
async function createShop(): Promise<string> {
  const result = await owner().query<{ id: string }>(
    'INSERT INTO public.shops (name, subdomain) VALUES ($1, $2) RETURNING id::text AS id',
    ['Negozio di prova NEG-T09', `neg-t09-${randomUUID().slice(0, 8)}`],
  );
  const id = result.rows[0]!.id;
  created.push(id);
  return id;
}

const ctxOf = (shopId: string, userId = USER_A): ShopCtx => ({ shopId, userId, actor: 'user' });

interface StoredRow {
  ciphertext: Buffer;
  created_at: string;
  rotated_at: string | null;
}

/** La riga del segreto letta dal proprietario (bytea come Buffer), oppure undefined. */
async function rowOf(shopId: string, name: string): Promise<StoredRow | undefined> {
  const result = await owner().query<StoredRow>(
    `SELECT ciphertext, created_at::text AS created_at, rotated_at::text AS rotated_at
       FROM public.shop_secrets WHERE shop_id = $1::uuid AND name = $2`,
    [shopId, name],
  );
  return result.rows[0];
}

interface AuditRow {
  action: string;
  object_type: string | null;
  object_id: string | null;
  before: unknown;
  after: unknown;
  actor_type: string;
  actor_user_id: string | null;
  whole: string;
}

/** Le righe di registro del negozio, in ordine, con la riga intera come testo. */
async function auditOf(shopId: string): Promise<AuditRow[]> {
  const result = await owner().query<AuditRow>(
    `SELECT action, object_type, object_id, before, after, actor_type, actor_user_id, row_to_json(a)::text AS whole
       FROM public.audit_log a WHERE shop_id = $1::uuid ORDER BY created_at, id`,
    [shopId],
  );
  return result.rows;
}

const actionsOf = async (shopId: string) => (await auditOf(shopId)).map((row) => [row.action, row.object_id]);

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('La chiamata doveva fallire.');
}

describe('segreti per negozio con app_user', () => {
  it('NEG-014: dopo setShopSecret la colonna ciphertext (42 byte) non contiene il valore, getShopSecret lo restituisce e la riga di registro shop_secret_set ha solo il nome', async () => {
    const shop = await createShop();
    await setShopSecret(ctxOf(shop), 'prova', SECRET);

    const row = await rowOf(shop, 'prova');
    expect(row).toBeDefined();
    expect(Buffer.isBuffer(row!.ciphertext)).toBe(true);
    expect(row!.ciphertext.length).toBe(42);
    expect(row!.ciphertext.includes(Buffer.from(SECRET, 'utf8'))).toBe(false);
    expect(row!.rotated_at).toBeNull();
    const plain = await owner().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.shop_secrets s
        WHERE s.shop_id = $1::uuid
          AND (position(convert_to($2, 'UTF8') IN s.ciphertext) > 0
               OR encode(s.ciphertext, 'escape') LIKE '%' || $2 || '%'
               OR row_to_json(s)::text LIKE '%' || $2 || '%')`,
      [shop, SECRET],
    );
    expect(plain.rows[0]?.n).toBe(0);

    await expect(getShopSecret(ctxOf(shop), 'prova')).resolves.toBe(SECRET);

    const audit = await auditOf(shop);
    expect(audit).toEqual([
      {
        action: 'shop_secret_set',
        object_type: 'shop_secret',
        object_id: 'prova',
        before: null,
        after: null,
        actor_type: 'user',
        actor_user_id: USER_A,
        whole: expect.any(String),
      },
    ]);
    expect(audit[0]!.whole).not.toContain(SECRET);
  });

  it('NEG-014: con il contesto di B getShopSecret non vede il segreto di A, e il testo cifrato copiato su una riga di B o con un altro nome non si decifra (autenticazione GCM fallita)', async () => {
    const shopA = await createShop();
    const shopB = await createShop();
    await setShopSecret(ctxOf(shopA), 'prova', SECRET);
    await expect(getShopSecret(ctxOf(shopB, USER_B), 'prova')).resolves.toBeNull();

    // Il proprietario copia il testo cifrato di A su una riga di B con lo stesso nome e su una riga di A con un altro
    // nome: le righe esistono e si leggono, ma i dati autenticati (negozio e nome) non coincidono.
    await owner().query(
      `INSERT INTO public.shop_secrets (shop_id, name, ciphertext)
       SELECT $2::uuid, name, ciphertext FROM public.shop_secrets WHERE shop_id = $1::uuid AND name = 'prova'`,
      [shopA, shopB],
    );
    await owner().query(
      `INSERT INTO public.shop_secrets (shop_id, name, ciphertext)
       SELECT shop_id, 'altro', ciphertext FROM public.shop_secrets WHERE shop_id = $1::uuid AND name = 'prova'`,
      [shopA],
    );
    const attempts: [ShopCtx, string][] = [
      [ctxOf(shopB, USER_B), 'prova'],
      [ctxOf(shopA), 'altro'],
    ];
    for (const [ctx, name] of attempts) {
      const error = await errorOf(getShopSecret(ctx, name));
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DbError);
      expect((error as Error).message).toBe(AUTH_FAILED);
      expect(inspect(error)).not.toContain(SECRET);
    }
    // Controllo positivo: la riga originale si legge ancora.
    await expect(getShopSecret(ctxOf(shopA), 'prova')).resolves.toBe(SECRET);
  });

  it('NEG-014: una seconda scrittura ruota il segreto con il permesso per colonna di app_user: rotated_at impostato, created_at invariato, shop_secret_rotated e valore nuovo', async () => {
    const shop = await createShop();
    await setShopSecret(ctxOf(shop), 'prova', SECRET);
    const first = await rowOf(shop, 'prova');
    await setShopSecret(ctxOf(shop), 'prova', 'valore-nuovo');
    const second = await rowOf(shop, 'prova');

    expect(second!.rotated_at).not.toBeNull();
    expect(second!.created_at).toBe(first!.created_at);
    expect(second!.ciphertext.equals(first!.ciphertext)).toBe(false);
    await expect(getShopSecret(ctxOf(shop), 'prova')).resolves.toBe('valore-nuovo');
    expect(await actionsOf(shop)).toEqual([
      ['shop_secret_set', 'prova'],
      ['shop_secret_rotated', 'prova'],
    ]);
    for (const row of await auditOf(shop)) {
      expect(row).toMatchObject({ object_type: 'shop_secret', before: null, after: null });
      expect(row.whole).not.toContain(SECRET);
      expect(row.whole).not.toContain('valore-nuovo');
    }
  });

  it('NEG-014: deleteShopSecret cancella la riga e scrive shop_secret_deleted; senza riga restituisce false e non scrive nel registro', async () => {
    const shop = await createShop();
    await setShopSecret(ctxOf(shop), 'prova', SECRET);
    await expect(deleteShopSecret(ctxOf(shop), 'prova')).resolves.toBe(true);
    expect(await rowOf(shop, 'prova')).toBeUndefined();
    await expect(getShopSecret(ctxOf(shop), 'prova')).resolves.toBeNull();
    await expect(deleteShopSecret(ctxOf(shop), 'prova')).resolves.toBe(false);

    const audit = await auditOf(shop);
    expect(audit.map((row) => row.action)).toEqual(['shop_secret_set', 'shop_secret_deleted']);
    expect(audit[1]).toMatchObject({
      object_type: 'shop_secret',
      object_id: 'prova',
      before: null,
      after: null,
      actor_type: 'user',
      actor_user_id: USER_A,
    });
  });

  it('NEG-014: con un contesto in sola lettura setShopSecret e deleteShopSecret falliscono con 25006 e nulla cambia', async () => {
    const shop = await createShop();
    await setShopSecret(ctxOf(shop), 'prova', SECRET);
    const before = await rowOf(shop, 'prova');
    const readOnly: ShopCtx = { ...ctxOf(shop), readOnly: true };

    for (const call of [
      () => setShopSecret(readOnly, 'prova', 'valore-nuovo'),
      () => setShopSecret(readOnly, 'nuovo', SECRET),
      () => deleteShopSecret(readOnly, 'prova'),
    ]) {
      const error = await errorOf(call());
      expect(error).toBeInstanceOf(DbError);
      expect((error as DbError).code).toBe('25006');
      expect(inspect(error)).not.toContain(SECRET);
    }

    const after = await rowOf(shop, 'prova');
    expect(after!.ciphertext.equals(before!.ciphertext)).toBe(true);
    expect(after!.rotated_at).toBeNull();
    expect(await rowOf(shop, 'nuovo')).toBeUndefined();
    expect(await actionsOf(shop)).toEqual([['shop_secret_set', 'prova']]);
  });

  it('OPS-020: se la scrittura del registro fallisce (attore non valido), il segreto non resta', async () => {
    const shop = await createShop();
    const ctx = { ...ctxOf(shop), actor: 'robot' as ShopCtx['actor'] };
    const error = await errorOf(setShopSecret(ctx, 'prova', SECRET));
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '23514', constraint: 'audit_log_actor_type_check' });
    expect(inspect(error)).not.toContain(SECRET);
    expect(await rowOf(shop, 'prova')).toBeUndefined();
    expect(await auditOf(shop)).toEqual([]);
  });

  it('OPS-020: se la scrittura del registro fallisce (attore non valido), deleteShopSecret non cancella il segreto', async () => {
    const shop = await createShop();
    await setShopSecret(ctxOf(shop), 'prova', SECRET);
    const before = await rowOf(shop, 'prova');
    const ctx = { ...ctxOf(shop), actor: 'robot' as ShopCtx['actor'] };
    const error = await errorOf(deleteShopSecret(ctx, 'prova'));
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '23514', constraint: 'audit_log_actor_type_check' });
    const after = await rowOf(shop, 'prova');
    expect(after).toBeDefined();
    expect(after!.ciphertext.equals(before!.ciphertext)).toBe(true);
    await expect(getShopSecret(ctxOf(shop), 'prova')).resolves.toBe(SECRET);
    expect(await actionsOf(shop)).toEqual([['shop_secret_set', 'prova']]);
  });
});

describe('tabella shop_secrets ed esportazione', () => {
  it('NEG-014: ogni colonna esclusa dall’esportazione (redact.ts) esiste nelle tabelle già create', async () => {
    const checked: string[] = [];
    for (const [table, columns] of Object.entries(EXPORT_EXCLUDED_COLUMNS)) {
      const found = await owner().query<{ name: string }>(
        `SELECT a.attname::text AS name FROM pg_attribute a
          WHERE a.attrelid = to_regclass('public.' || quote_ident($1)) AND a.attnum > 0 AND NOT a.attisdropped`,
        [table],
      );
      if (found.rows.length === 0) continue; // tabella non ancora creata (invitations nasce in ACC-T06)
      const names = found.rows.map((row) => row.name);
      for (const column of columns) {
        expect(names, `${table}.${column}`).toContain(column);
        checked.push(`${table}.${column}`);
      }
    }
    // Controllo positivo: la tabella dei segreti esiste e la sua colonna esclusa è stata controllata.
    expect(checked).toContain('shop_secrets.ciphertext');
  });

  it('02§Segreti: colonne obbligatorie e facoltative della tabella, e chiave esterna su shop_id verso shops con ON DELETE CASCADE', async () => {
    const columns = await owner().query<{ name: string; not_null: boolean }>(
      `SELECT a.attname::text AS name, a.attnotnull AS not_null FROM pg_attribute a
        WHERE a.attrelid = 'public.shop_secrets'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
    );
    expect(columns.rows).toEqual([
      { name: 'id', not_null: true },
      { name: 'shop_id', not_null: true },
      { name: 'name', not_null: true },
      { name: 'ciphertext', not_null: true },
      { name: 'created_at', not_null: true },
      { name: 'rotated_at', not_null: false },
    ]);
    const foreignKeys = await owner().query<{ to_shops: boolean; on_delete: string; columns: string[] }>(
      `SELECT c.confrelid = 'public.shops'::regclass AS to_shops, c.confdeltype::text AS on_delete,
              array(SELECT a.attname::text FROM pg_attribute a
                     WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) ORDER BY a.attnum) AS columns
         FROM pg_constraint c
        WHERE c.conrelid = 'public.shop_secrets'::regclass AND c.contype = 'f'`,
    );
    expect(foreignKeys.rows).toEqual([{ to_shops: true, on_delete: 'c', columns: ['shop_id'] }]);
  });

  it('NEG-004: la fixture di shop_secrets scrive per il negozio una riga inerte, nome fixture_isolation e 28 byte a zero, senza la chiave', async () => {
    const shop = await createShop();
    const fixture = SHOP_DATA_FIXTURES.shop_secrets;
    expect(fixture).toBeDefined();
    // La fixture gira anche in isolation-check, nel servizio migrate, che non ha SHOP_SECRETS_KEY (nota (3)).
    vi.stubEnv('SHOP_SECRETS_KEY', undefined);
    await fixture!(owner(), { id: shop, subdomain: 'neg-t09-fixture', userId: 'fixture-user-neg-t09' });
    const rows = await owner().query<{ name: string; ciphertext: Buffer }>(
      'SELECT name, ciphertext FROM public.shop_secrets WHERE shop_id = $1::uuid',
      [shop],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.name).toBe('fixture_isolation');
    expect(rows.rows[0]!.ciphertext.equals(Buffer.alloc(28))).toBe(true);
  });

  it('02§Segreti: il proprietario non inserisce un nome fuori formato, un ciphertext di 27 byte né due righe con lo stesso negozio e nome', async () => {
    const shop = await createShop();
    const insert = (name: string, bytes: number) =>
      owner().query('INSERT INTO public.shop_secrets (shop_id, name, ciphertext) VALUES ($1::uuid, $2, $3::bytea)', [
        shop,
        name,
        Buffer.alloc(bytes),
      ]);
    for (const name of ['', 'Prova', 'prova!', 'a b', 'a:b', 'nome-con-trattino', 'x'.repeat(65)]) {
      await expect(insert(name, 28), name).rejects.toMatchObject({
        code: '23514',
        constraint: 'shop_secrets_name_format_check',
      });
    }
    await expect(insert('prova', 27)).rejects.toMatchObject({
      code: '23514',
      constraint: 'shop_secrets_ciphertext_length_check',
    });
    await insert('x'.repeat(64), 28);
    await insert('fiscale.fornitore.api_key', 28);
    await expect(insert('fiscale.fornitore.api_key', 28)).rejects.toMatchObject({
      code: '23505',
      constraint: 'shop_secrets_shop_id_name_unique',
    });
  });
});
