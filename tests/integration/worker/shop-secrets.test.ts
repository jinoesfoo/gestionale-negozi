import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { createDbContext, type ShopCtx } from '@/server/db/context';
import { DbError } from '@/server/db/errors';
import { createShopSecrets, deleteShopSecret, getShopSecret, setShopSecret } from '@/server/secrets/shop-secrets';
import { closeRolePools, rolePool, testDatabaseUrl } from '../../fixtures/db';

// Segreti per negozio nel worker (02 §Segreti per negozio, NEG-014 e NEG-012; NEG-T09, note (2), (4)(h) e (8) del
// piano): le funzioni esportate girano con DATABASE_URL = app_worker (progetto int-worker), che su shop_secrets ha solo
// SELECT. Il segreto lo scrive app_user, con createShopSecrets su un pool suo di una sola connessione; la chiave è
// SHOP_SECRETS_KEY di .env.test, la stessa per i due ruoli, come in app.env e worker.env dei server. Il worker apre
// withShop come un lavoro di sistema (userId nullo, actor 'system'). I negozi li crea il proprietario e li cancella per
// id alla fine: segreti e righe di registro seguono con ON DELETE CASCADE.

const SECRET = 'valore-segreto';
const USER = 'utente-neg-t09-worker';

const owner = () => rolePool('owner');
const created: string[] = [];
let appPool: Pool;
let asApp: ReturnType<typeof createShopSecrets>;

beforeAll(() => {
  appPool = new Pool({ connectionString: testDatabaseUrl('app'), max: 1 });
  appPool.on('error', () => undefined);
  asApp = createShopSecrets({ withShop: createDbContext(appPool).withShop });
});

afterAll(async () => {
  if (created.length > 0) {
    await owner().query('DELETE FROM public.shops WHERE id = ANY($1::uuid[])', [created]);
  }
  await appPool?.end();
  await closeDb();
  await closeRolePools();
});

async function createShop(): Promise<string> {
  const result = await owner().query<{ id: string }>(
    'INSERT INTO public.shops (name, subdomain) VALUES ($1, $2) RETURNING id::text AS id',
    ['Negozio di prova NEG-T09 worker', `neg-t09-w-${randomUUID().slice(0, 8)}`],
  );
  const id = result.rows[0]!.id;
  created.push(id);
  return id;
}

const asUser = (shopId: string): ShopCtx => ({ shopId, userId: USER, actor: 'user' });
const asSystem = (shopId: string): ShopCtx => ({ shopId, userId: null, actor: 'system' });

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('La chiamata doveva fallire.');
}

describe('segreti per negozio con app_worker', () => {
  it('NEG-014: app_worker legge con getShopSecret il segreto scritto da app_user', async () => {
    const shop = await createShop();
    await asApp.setShopSecret(asUser(shop), 'prova', SECRET);
    await expect(getShopSecret(asSystem(shop), 'prova')).resolves.toBe(SECRET);
    await expect(getShopSecret(asSystem(shop), 'assente')).resolves.toBeNull();
  });

  it('NEG-012: app_worker non scrive shop_secrets: setShopSecret e deleteShopSecret falliscono con 42501 permission denied e la riga resta com’era', async () => {
    const shop = await createShop();
    await asApp.setShopSecret(asUser(shop), 'prova', SECRET);
    const before = await owner().query<{ ciphertext: Buffer; rotated_at: string | null }>(
      "SELECT ciphertext, rotated_at::text AS rotated_at FROM public.shop_secrets WHERE shop_id = $1::uuid AND name = 'prova'",
      [shop],
    );

    for (const call of [
      () => setShopSecret(asSystem(shop), 'prova', 'valore-nuovo'),
      () => setShopSecret(asSystem(shop), 'nuovo', SECRET),
      () => deleteShopSecret(asSystem(shop), 'prova'),
    ]) {
      const error = await errorOf(call());
      expect(error).toBeInstanceOf(DbError);
      expect((error as DbError).code).toBe('42501');
      expect((error as DbError).message).toMatch(/^permission denied for table shop_secrets/);
    }

    const after = await owner().query<{ name: string; ciphertext: Buffer; rotated_at: string | null }>(
      'SELECT name, ciphertext, rotated_at::text AS rotated_at FROM public.shop_secrets WHERE shop_id = $1::uuid',
      [shop],
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.name).toBe('prova');
    expect(after.rows[0]!.ciphertext.equals(before.rows[0]!.ciphertext)).toBe(true);
    expect(after.rows[0]!.rotated_at).toBeNull();
    const audit = await owner().query<{ action: string }>(
      'SELECT action FROM public.audit_log WHERE shop_id = $1::uuid ORDER BY created_at, id',
      [shop],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['shop_secret_set']);
    await expect(getShopSecret(asSystem(shop), 'prova')).resolves.toBe(SECRET);
  });
});
