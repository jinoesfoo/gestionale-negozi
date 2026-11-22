import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { audit } from '@/server/audit';
import { closeDb, getDb } from '@/server/db/client';
import { closeRolePools, rolePool } from '../../fixtures/db';

// Registro delle azioni ed esclusioni dalle email (01 FON-T10; 02 §Funzioni di contesto e §Funzioni di piattaforma;
// 08 §Registro): le migrazioni di FON-T10 creano app_shop_id() e app_user_id(), la tabella audit_log (policy standard,
// app_user e app_worker solo SELECT e INSERT), la funzione di piattaforma audit_platform(...) (SECURITY DEFINER di
// app_owner, search_path fisso, eseguibile solo da app_user e app_worker) e la tabella di piattaforma
// email_suppressions (app_user solo INSERT, app_worker solo SELECT). I controlli del catalogo e dei permessi leggono
// con il proprietario; le prove di comportamento girano con il ruolo vero (app_user, il client dell'app).

const AUDIT_PLATFORM = 'public.audit_platform(text, text, text, text, text, jsonb, jsonb, inet, text)';
const DOMAIN = 'fon-t10-registro.example.com';
const TEST_ACTION = 'test_fon_t10';

const owner = () => rolePool('owner');
const createdShops: string[] = [];

afterAll(async () => {
  await owner().query('DELETE FROM public.audit_log WHERE action = $1', [TEST_ACTION]);
  await owner().query('DELETE FROM public.shops WHERE id = ANY($1::uuid[])', [createdShops]);
  await owner().query('DELETE FROM public.email_suppressions WHERE email LIKE $1', [`%@${DOMAIN}`]);
  await closeDb();
  await closeRolePools();
});

/**
 * Un negozio vero, creato dal proprietario e cancellato alla fine: da NEG-T01 audit_log.shop_id fa riferimento a
 * shops(id), e una riga di un negozio inesistente è rifiutata (02 NEG-T01, nota (6) del piano).
 */
async function createShop(): Promise<string> {
  const result = await owner().query<{ id: string }>(
    'INSERT INTO public.shops (name, subdomain) VALUES ($1, $2) RETURNING id::text AS id',
    ['Negozio di prova FON-T10', `fon-t10-${randomUUID().slice(0, 8)}`],
  );
  const id = result.rows[0]!.id;
  createdShops.push(id);
  return id;
}

async function tablePrivileges(role: string, table: string) {
  const result = await owner().query<Record<string, boolean>>(
    `SELECT has_table_privilege($1, $2, 'SELECT') AS select,
            has_table_privilege($1, $2, 'INSERT') AS insert,
            has_table_privilege($1, $2, 'UPDATE') AS update,
            has_table_privilege($1, $2, 'DELETE') AS delete,
            has_table_privilege($1, $2, 'TRUNCATE') AS truncate`,
    [role, table],
  );
  return result.rows[0];
}

describe('funzioni di contesto', () => {
  it('NEG-013: app_shop_id() e app_user_id() leggono il contesto della transazione e valgono NULL senza (anche dopo un valore vuoto)', async () => {
    const shopId = randomUUID();
    const rows = await getDb().transaction(async (tx) => {
      const before = await tx.execute(sql`SELECT app_shop_id() AS shop, app_user_id() AS usr`);
      await tx.execute(
        sql`SELECT set_config('app.shop_id', ${shopId}, true), set_config('app.user_id', 'utente-1', true)`,
      );
      const inside = await tx.execute(sql`SELECT app_shop_id()::text AS shop, app_user_id() AS usr`);
      await tx.execute(sql`SELECT set_config('app.shop_id', '', true), set_config('app.user_id', '', true)`);
      const emptied = await tx.execute(sql`SELECT app_shop_id() AS shop, app_user_id() AS usr`);
      return { before: before.rows[0], inside: inside.rows[0], emptied: emptied.rows[0] };
    });
    expect(rows.before).toEqual({ shop: null, usr: null });
    expect(rows.inside).toEqual({ shop: shopId, usr: 'utente-1' });
    expect(rows.emptied).toEqual({ shop: null, usr: null });
  });

  it('NEG-013: app_shop_id() e app_user_id() sono eseguibili da app_user e app_worker', async () => {
    for (const role of ['app_user', 'app_worker']) {
      for (const fn of ['public.app_shop_id()', 'public.app_user_id()']) {
        const result = await owner().query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [
          role,
          fn,
        ]);
        expect(result.rows[0]?.ok, `${role} ${fn}`).toBe(true);
      }
    }
  });
});

describe('audit_log', () => {
  it('NEG-013: audit_log ha RLS abilitata e forzata, con la policy shop_isolation su app_shop_id()', async () => {
    const table = await owner().query<{ enabled: boolean; forced: boolean }>(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'public.audit_log'::regclass`,
    );
    expect(table.rows[0]).toEqual({ enabled: true, forced: true });
    const policies = await owner().query<{ name: string; qual: string; check: string }>(
      `SELECT policyname AS name, qual, with_check AS check FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'audit_log'`,
    );
    expect(policies.rows).toHaveLength(1);
    expect(policies.rows[0]?.name).toBe('shop_isolation');
    expect(policies.rows[0]?.qual).toContain('app_shop_id()');
    expect(policies.rows[0]?.check).toContain('app_shop_id()');
  });

  it('OPS-021: app_user e app_worker hanno su audit_log solo SELECT e INSERT; app_jobs nessun permesso', async () => {
    for (const role of ['app_user', 'app_worker']) {
      expect(await tablePrivileges(role, 'public.audit_log'), role).toEqual({
        select: true,
        insert: true,
        update: false,
        delete: false,
        truncate: false,
      });
    }
    expect(await tablePrivileges('app_jobs', 'public.audit_log')).toEqual({
      select: false,
      insert: false,
      update: false,
      delete: false,
      truncate: false,
    });
  });

  it('NEG-013: audit(tx, …) scrive la riga del negozio nella transazione ricevuta, e sparisce se la transazione si annulla', async () => {
    const shopId = await createShop();
    const kept = `tenuta-${randomUUID()}`;
    const dropped = `annullata-${randomUUID()}`;

    await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.shop_id', ${shopId}, true)`);
      await audit(tx, { shopId, actorType: 'system', action: TEST_ACTION, objectType: 'prova', objectId: kept });
    });
    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.shop_id', ${shopId}, true)`);
        await audit(tx, { shopId, actorType: 'system', action: TEST_ACTION, objectType: 'prova', objectId: dropped });
        throw new Error('annullamento voluto');
      }),
    ).rejects.toThrow('annullamento voluto');

    const rows = await owner().query<{ object_id: string; shop_id: string; actor_type: string }>(
      'SELECT object_id, shop_id::text AS shop_id, actor_type FROM public.audit_log WHERE action = $1 AND shop_id = $2',
      [TEST_ACTION, shopId],
    );
    expect(rows.rows).toEqual([{ object_id: kept, shop_id: shopId, actor_type: 'system' }]);
  });
});

describe('audit_platform', () => {
  it('NEG-013: è SECURITY DEFINER di app_owner, con search_path = public, pg_temp', async () => {
    const result = await owner().query<{ definer: boolean; owner: string; config: string[] | null }>(
      `SELECT prosecdef AS definer, pg_get_userbyid(proowner) AS owner, proconfig AS config
         FROM pg_proc WHERE oid = $1::regprocedure`,
      [AUDIT_PLATFORM],
    );
    expect(result.rows[0]?.definer).toBe(true);
    expect(result.rows[0]?.owner).toBe('app_owner');
    expect(result.rows[0]?.config).toContain('search_path=public, pg_temp');
  });

  it('FON-011: è eseguibile da app_user e app_worker, non da PUBLIC né da app_jobs', async () => {
    for (const [role, expected] of [
      ['app_user', true],
      ['app_worker', true],
      ['app_jobs', false],
    ] as const) {
      const result = await owner().query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [
        role,
        AUDIT_PLATFORM,
      ]);
      expect(result.rows[0]?.ok, role).toBe(expected);
    }
    // PUBLIC: nessuna voce con grantee 0 nell'elenco dei permessi, e l'elenco non è quello predefinito (NULL), che a
    // PUBLIC darebbe EXECUTE.
    const acl = await owner().query<{ has_acl: boolean; public_execute: boolean }>(
      `SELECT proacl IS NOT NULL AS has_acl,
              EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
                AS public_execute
         FROM pg_proc WHERE oid = $1::regprocedure`,
      [AUDIT_PLATFORM],
    );
    expect(acl.rows[0]).toEqual({ has_acl: true, public_execute: false });
  });

  it('FON-011: scritta da app_user, la riga di piattaforma ha shop_id nullo e app_user non la vede', async () => {
    const objectId = `piattaforma-${randomUUID()}`;
    await getDb().execute(
      sql`SELECT public.audit_platform('system', NULL, ${TEST_ACTION}, 'prova', ${objectId}, NULL, '{"k": 1}'::jsonb, NULL, NULL)`,
    );
    const seen = await getDb().execute(
      sql`SELECT count(*)::int AS n FROM public.audit_log WHERE object_id = ${objectId}`,
    );
    expect(seen.rows[0]).toEqual({ n: 0 });

    const stored = await owner().query<{ shop_id: string | null; actor_type: string; after: unknown }>(
      'SELECT shop_id, actor_type, after FROM public.audit_log WHERE object_id = $1',
      [objectId],
    );
    expect(stored.rows).toEqual([{ shop_id: null, actor_type: 'system', after: { k: 1 } }]);
  });

  it('NEG-013: rifiuta un actor_type diverso da user, admin e system', async () => {
    await expect(
      getDb().execute(
        sql`SELECT public.audit_platform('robot', NULL, ${TEST_ACTION}, 'prova', 'x', NULL, NULL, NULL, NULL)`,
      ),
    ).rejects.toThrow();
  });
});

describe('email_suppressions', () => {
  it('FON-011: app_user ha solo INSERT, app_worker solo SELECT, app_jobs nessun permesso', async () => {
    const none = { select: false, insert: false, update: false, delete: false, truncate: false };
    expect(await tablePrivileges('app_user', 'public.email_suppressions')).toEqual({ ...none, insert: true });
    expect(await tablePrivileges('app_worker', 'public.email_suppressions')).toEqual({ ...none, select: true });
    expect(await tablePrivileges('app_jobs', 'public.email_suppressions')).toEqual(none);
  });

  it('FON-011: app_user inserisce con ON CONFLICT DO NOTHING senza colonna: 1 riga la prima volta, 0 la seconda', async () => {
    const email = `conflitto-${randomUUID()}@${DOMAIN}`;
    const insert = sql`INSERT INTO public.email_suppressions (email, reason) VALUES (${email}, 'bounce') ON CONFLICT DO NOTHING`;
    expect((await getDb().execute(insert)).rowCount).toBe(1);
    expect((await getDb().execute(insert)).rowCount).toBe(0);
  });

  it('FON-011: accetta solo indirizzi in minuscolo e i motivi bounce e complaint', async () => {
    await expect(
      owner().query("INSERT INTO public.email_suppressions (email, reason) VALUES ($1, 'bounce')", [
        `Maiuscolo-${randomUUID()}@${DOMAIN}`,
      ]),
    ).rejects.toThrow();
    await expect(
      owner().query("INSERT INTO public.email_suppressions (email, reason) VALUES ($1, 'altro')", [
        `motivo-${randomUUID()}@${DOMAIN}`,
      ]),
    ).rejects.toThrow();
  });

  it('FON-011: la chiave primaria email è l’unico indice unico della tabella', async () => {
    const result = await owner().query<{ name: string; primary: boolean }>(
      `SELECT c.relname AS name, i.indisprimary AS primary FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = 'public.email_suppressions'::regclass AND i.indisunique`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.primary).toBe(true);
  });
});
