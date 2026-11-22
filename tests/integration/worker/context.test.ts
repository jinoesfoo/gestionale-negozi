import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { audit } from '@/server/audit';
import { closeDb } from '@/server/db/client';
import { withShop } from '@/server/db/context';
import { DbError } from '@/server/db/errors';
import { resolveHost } from '@/server/db/resolve-host';
import * as schema from '@/server/db/schema';
import { closeRolePools, rolePool } from '../../fixtures/db';

// withShop e audit() nel worker (02 §withShop, 08 §Registro; NEG-T02, nota (9) del piano): stesso codice dell'app, con
// DATABASE_URL = app_worker (progetto int-worker), che su audit_log ha SELECT e INSERT e su shops solo SELECT. Il
// worker apre withShop con userId nullo e actor 'system' (per esempio billing.sync, 05) o con un utente (exports.build).

const TEST_ACTION = 'test_neg_t02_worker';
const owner = () => rolePool('owner');
const created: string[] = [];

afterAll(async () => {
  await owner().query('DELETE FROM public.shops WHERE id = ANY($1::uuid[])', [created]);
  await owner().query('DELETE FROM public.audit_log WHERE action = $1', [TEST_ACTION]);
  await closeDb();
  await closeRolePools();
});

async function createShop(): Promise<string> {
  const result = await owner().query<{ id: string }>(
    'INSERT INTO public.shops (name, subdomain) VALUES ($1, $2) RETURNING id::text AS id',
    ['Negozio di prova NEG-T02 worker', `neg-t02-w-${randomUUID().slice(0, 8)}`],
  );
  const id = result.rows[0]!.id;
  created.push(id);
  return id;
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('la promessa doveva fallire');
}

describe('withShop nel worker', () => {
  it('NEG-013: nel worker (app_worker) audit() dentro withShop scrive la riga con shop_id e actor_user_id del contesto', async () => {
    const shopId = await createShop();
    const objectId = `worker-${randomUUID()}`;
    const role = await withShop({ shopId, userId: 'utente-worker-neg-t02', actor: 'system' }, async (tx) => {
      await audit(tx, { actorType: 'system', action: TEST_ACTION, objectType: 'prova', objectId });
      return (await tx.execute<{ role: string }>(sql`SELECT current_user AS role`)).rows[0]?.role;
    });
    expect(role).toBe('app_worker');
    const stored = await owner().query(
      'SELECT shop_id::text AS shop_id, actor_type, actor_user_id FROM public.audit_log WHERE object_id = $1',
      [objectId],
    );
    expect(stored.rows).toEqual([{ shop_id: shopId, actor_type: 'system', actor_user_id: 'utente-worker-neg-t02' }]);
  });

  it('02§withShop: nel worker withShop in sola lettura legge il negozio del contesto e audit() fallisce con 25006', async () => {
    const shopId = await createShop();
    const visible = await withShop({ shopId, userId: null, actor: 'system', readOnly: true }, (tx) =>
      tx.select({ id: schema.shops.id }).from(schema.shops).where(eq(schema.shops.id, shopId)),
    );
    expect(visible).toEqual([{ id: shopId }]);
    const error = await errorOf(
      withShop({ shopId, userId: null, actor: 'system', readOnly: true }, (tx) =>
        audit(tx, { actorType: 'system', action: TEST_ACTION }),
      ),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '25006' });
  });
});

describe('resolveHost con un errore del database', () => {
  // app_worker non ha EXECUTE su resolve_host (solo app_user, nota (4) del piano): qui (DATABASE_URL = app_worker,
  // PUBLIC_BASE_DOMAIN = localhost da .env.test) il risolutore predefinito riceve un errore vero del database, senza
  // cambiare permessi nel database condiviso. Nota (2): anche resolveHost restituisce i suoi errori del database come
  // DbError; nota (5): un errore non entra in cache.
  it('00§4.2: resolveHost restituisce un errore del database come DbError (42501), senza cause, query né host, e non lo mette in cache', async () => {
    const label = `neg-t02-r-${randomUUID().slice(0, 8)}`;
    for (const attempt of [1, 2]) {
      const error = await errorOf(resolveHost(`${label}.localhost`));
      expect(error, `tentativo ${attempt}`).toBeInstanceOf(DbError);
      expect(error, `tentativo ${attempt}`).toMatchObject({ code: '42501' });
      expect((error as DbError).message).toMatch(/^permission denied for function resolve_host/);
      expect((error as DbError).cause).toBeUndefined();
      const text = inspect(error, { depth: null });
      for (const value of [label, 'Failed query', 'params:']) expect(text).not.toContain(value);
    }
  });
});
