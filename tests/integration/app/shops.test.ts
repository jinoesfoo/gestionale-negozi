import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { platform } from '@/config/platform';
import { runMigrations } from '@/migrate';
import { createOwnerConnection } from '@/server/db/owner-client';
import { syncPlatformConfig } from '@/server/db/platform-config';
import { closeRolePools, rolePool, testDatabaseUrl, type TestRole } from '../../fixtures/db';

// Tabella dei negozi e valori di configurazione (02 NEG-T01, note (1)–(7) del piano): `shops` con i vincoli di NEG-001,
// la policy standard su `id`, i permessi di NEG-009 (app_user: SELECT e UPDATE delle sole colonne dei dati del
// negozio; app_worker: solo SELECT); la chiave esterna audit_log.shop_id → shops(id) ON DELETE CASCADE; la tabella di
// piattaforma platform_config, senza permessi ai ruoli di runtime, scritta da src/migrate.ts con i valori di
// src/config/platform.ts e letta con platform_config_get() (U, W). I negozi di questo file li crea e li cancella il
// proprietario; le prove di comportamento girano con il ruolo vero (app_user, app_worker).

const owner = () => rolePool('owner');
const created: string[] = [];
const TEST_ACTION = 'test_neg_t01';

/** Un sottodominio valido e unico per questo file. */
const sub = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}`;

/** Le coppie che migrate.ts scrive, lette dal file (nota (1) del piano). */
const EXPECTED_CONFIG: Record<string, unknown> = {
  closedRetentionDays: platform.closedRetentionDays,
  suspendedDaysBeforeClose: platform.suspendedDaysBeforeClose,
  graceDays: platform.graceDays,
  exportRetentionDays: platform.exportRetentionDays,
  trialInactiveDaysBeforeClose: platform.trialInactiveDaysBeforeClose,
  'invoicing.regime': platform.invoicing.regime,
  'invoicing.bolloThresholdCents': platform.invoicing.bolloThresholdCents,
  'invoicing.bolloCents': platform.invoicing.bolloCents,
};

const DATA_COLUMNS = ['name', 'legal_name', 'vat_number', 'tax_code', 'sdi_code', 'pec', 'address'];

afterAll(async () => {
  await owner().query('DELETE FROM public.audit_log WHERE action = $1', [TEST_ACTION]);
  await owner().query('DELETE FROM public.shops WHERE id = ANY($1::uuid[])', [created]);
  await owner().query("DELETE FROM public.platform_config WHERE key LIKE 'test.neg-t01.%'");
  await closeRolePools();
});

/** Crea un negozio con il proprietario e lo segna per la pulizia finale. */
async function createShop(subdomain = sub('neg-t01'), name = 'Negozio di prova NEG-T01'): Promise<string> {
  const result = await owner().query<{ id: string }>(
    'INSERT INTO public.shops (name, subdomain) VALUES ($1, $2) RETURNING id::text AS id',
    [name, subdomain],
  );
  const id = result.rows[0]!.id;
  created.push(id);
  return id;
}

/** Il codice d'errore di PostgreSQL della promessa, oppure undefined se riesce. */
async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? 'senza codice';
  }
  return undefined;
}

/** Inserisce un negozio con il proprietario, con le colonne date; il codice d'errore, oppure undefined se riesce. */
async function insertShop(columns: Record<string, unknown>): Promise<string | undefined> {
  const names = Object.keys(columns);
  const placeholders = names.map((name, i) => (name === 'address' ? `$${i + 1}::jsonb` : `$${i + 1}`));
  return errorCode(
    owner()
      .query<{ id: string }>(
        `INSERT INTO public.shops (${names.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id::text AS id`,
        Object.values(columns),
      )
      .then((result) => created.push(result.rows[0]!.id)),
  );
}

/** Esegue fn in una transazione con il ruolo dato e, se shopId non è null, con il contesto del negozio. */
async function asRole<T>(role: TestRole, shopId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await rolePool(role).connect();
  try {
    await client.query('BEGIN');
    if (shopId !== null) await client.query("SELECT set_config('app.shop_id', $1, true)", [shopId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function tablePrivileges(role: string, table: string) {
  const result = await owner().query<Record<string, boolean>>(
    `SELECT has_table_privilege($1, $2, 'SELECT') AS select,
            has_table_privilege($1, $2, 'INSERT') AS insert,
            has_table_privilege($1, $2, 'UPDATE') AS update,
            has_table_privilege($1, $2, 'DELETE') AS delete,
            has_table_privilege($1, $2, 'TRUNCATE') AS truncate,
            has_table_privilege($1, $2, 'REFERENCES') AS references,
            has_table_privilege($1, $2, 'TRIGGER') AS trigger`,
    [role, table],
  );
  return result.rows[0];
}

const NO_PRIVILEGES = {
  select: false,
  insert: false,
  update: false,
  delete: false,
  truncate: false,
  references: false,
  trigger: false,
};

describe('shops: colonne e vincoli', () => {
  it('NEG-001: shops ha le colonne di 02 §Tabella shops (suspended_at e failure_reminder_sent_at arrivano in BIL-T02)', async () => {
    const result = await owner().query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'shops' ORDER BY column_name`,
    );
    const tz = 'timestamp with time zone';
    expect(result.rows.map((row) => [row.column_name, row.data_type, row.is_nullable])).toEqual(
      [
        ['address', 'jsonb', 'YES'],
        ['closed_at', tz, 'YES'],
        ['created_at', tz, 'NO'],
        ['grace_started_at', tz, 'YES'],
        ['id', 'uuid', 'NO'],
        ['is_test', 'boolean', 'NO'],
        ['last_activity_at', tz, 'YES'],
        ['legal_name', 'text', 'YES'],
        ['name', 'text', 'NO'],
        ['pec', 'text', 'YES'],
        ['purge_notice_sent_at', tz, 'YES'],
        ['purge_requested_at', tz, 'YES'],
        ['reopened_at', tz, 'YES'],
        ['sdi_code', 'text', 'YES'],
        ['status', 'text', 'NO'],
        ['status_changed_at', tz, 'NO'],
        ['subdomain', 'text', 'NO'],
        ['tax_code', 'text', 'YES'],
        ['trial_inactivity_warned_at', tz, 'YES'],
        ['vat_number', 'text', 'YES'],
      ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
    );
  });

  it('NEG-001: un negozio nuovo ha id uuidv7, stato trial, is_test falso, le date di creazione e di stato e nessun’altra data', async () => {
    const id = await createShop();
    const result = await owner().query(
      `SELECT uuid_extract_version(id) AS version, status, is_test,
              status_changed_at IS NOT NULL AS has_status_changed_at, created_at IS NOT NULL AS has_created_at,
              grace_started_at, closed_at, reopened_at, trial_inactivity_warned_at, purge_requested_at,
              purge_notice_sent_at, last_activity_at
         FROM public.shops WHERE id = $1`,
      [id],
    );
    expect(result.rows).toEqual([
      {
        version: 7,
        status: 'trial',
        is_test: false,
        has_status_changed_at: true,
        has_created_at: true,
        grace_started_at: null,
        closed_at: null,
        reopened_at: null,
        trial_inactivity_warned_at: null,
        purge_requested_at: null,
        purge_notice_sent_at: null,
        last_activity_at: null,
      },
    ]);
  });

  it('NEG-001: due negozi con lo stesso sottodominio: il secondo è rifiutato con un errore di unicità', async () => {
    const subdomain = sub('doppio');
    await createShop(subdomain);
    expect(await insertShop({ name: 'Secondo negozio', subdomain })).toBe('23505');
  });

  it('NEG-001: il sottodominio accetta solo [a-z0-9-]{3,40}, senza "-" iniziale o finale', async () => {
    const hex = () => randomUUID().replace(/-/g, '');
    const valid = [
      `x${hex().slice(0, 2)}`, // 3 caratteri
      `n${hex()}${'a'.repeat(6)}9`, // 40 caratteri
      `neg-t01-${hex().slice(0, 8)}`,
      String(100_000_000 + Math.floor(Math.random() * 900_000_000)),
    ];
    for (const subdomain of valid) {
      expect(await insertShop({ name: 'Negozio valido', subdomain }), subdomain).toBeUndefined();
    }
    const invalid = [
      '',
      'ab',
      `n${'a'.repeat(39)}9`, // 41 caratteri
      `-${hex().slice(0, 8)}`,
      `${hex().slice(0, 8)}-`,
      `Negozio-${hex().slice(0, 8)}`,
      `neg_${hex().slice(0, 8)}`,
      `neg.${hex().slice(0, 8)}`,
      `neg ${hex().slice(0, 8)}`,
      `negò${hex().slice(0, 8)}`,
    ];
    for (const subdomain of invalid) {
      expect(await insertShop({ name: 'Negozio non valido', subdomain }), subdomain).toBe('23514');
    }
  });

  it('NEG-001: i sottodomini riservati di src/config/platform.ts (quelli di NEG-001) sono rifiutati', async () => {
    expect([...platform.reservedSubdomains]).toEqual([
      'admin',
      'app',
      'clienti',
      'www',
      'api',
      'mail',
      'status',
      'test',
      'static',
      'cdn',
      'n',
    ]);
    for (const subdomain of platform.reservedSubdomains) {
      expect(await insertShop({ name: 'Negozio riservato', subdomain }), subdomain).toBe('23514');
    }
  });

  it('NEG-001: dati fiscali, nome e stato: i valori validi passano, gli altri sono rifiutati dai vincoli', async () => {
    const base = () => ({
      name: 'Ferramenta Rossi',
      subdomain: sub('fiscali'),
      legal_name: 'Ferramenta Rossi S.r.l.',
      vat_number: '12345678901',
      tax_code: 'RSSMRA80A01H501U',
      sdi_code: '0000000',
      pec: 'ferramenta.rossi@pec.it',
      address: JSON.stringify({ street: 'Via Roma 1', city: 'Torino', zip: '10100', province: 'TO', country: 'IT' }),
    });
    expect(await insertShop(base())).toBeUndefined();
    expect(await insertShop({ ...base(), tax_code: '12345678901', sdi_code: 'M5UXCR1' })).toBeUndefined();
    expect(await insertShop({ ...base(), name: 'AB' })).toBeUndefined();
    expect(await insertShop({ ...base(), name: 'x'.repeat(120) })).toBeUndefined();

    const invalid: Array<[string, unknown]> = [
      ['vat_number', '1234567890'],
      ['vat_number', '123456789012'],
      ['vat_number', '1234567890A'],
      ['vat_number', 'IT12345678901'],
      ['tax_code', 'rssmra80a01h501u'],
      ['tax_code', 'RSSMRA80A01H501'],
      ['tax_code', 'RSSMRA80A01H501UX'],
      ['tax_code', '1234567890'],
      ['sdi_code', 'm5uxcr1'],
      ['sdi_code', 'M5UXCR'],
      ['sdi_code', 'M5UXCR12'],
      ['sdi_code', 'M5UX-R1'],
      ['pec', 'Ferramenta@pec.it'],
      ['pec', 'senza-chiocciola'],
      ['pec', 'a@b@pec.it'],
      ['pec', 'a b@pec.it'],
      ['pec', '@pec.it'],
      ['pec', 'ferramenta@'],
      ['address', '"Via Roma 1"'],
      ['address', '[]'],
      ['address', '42'],
      ['name', 'A'],
      ['name', 'x'.repeat(121)],
      ['status', 'aperto'],
    ];
    for (const [column, value] of invalid) {
      expect(await insertShop({ ...base(), [column]: value }), `${column}=${String(value)}`).toBe('23514');
    }
  });
});

describe('shops: separazione e permessi', () => {
  it('NEG-002: shops ha RLS abilitata e forzata, con la policy shop_isolation su id = app_shop_id()', async () => {
    const flags = await owner().query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.shops'::regclass",
    );
    expect(flags.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await owner().query<{ policyname: string; cmd: string; qual: string; with_check: string }>(
      "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shops'",
    );
    expect(policies.rows.map((row) => [row.policyname, row.cmd])).toEqual([['shop_isolation', 'ALL']]);
    expect(policies.rows[0]?.qual).toMatch(/\bid = app_shop_id\(\)/);
    expect(policies.rows[0]?.with_check).toMatch(/\bid = app_shop_id\(\)/);
  });

  it('NEG-003: senza contesto app_user legge 0 negozi, anche sulla stessa connessione dopo una transazione con contesto', async () => {
    const a = await createShop();
    await createShop();
    const client = await rolePool('app').connect();
    try {
      const before = await client.query('SELECT id FROM public.shops');
      expect(before.rows).toEqual([]);

      await client.query('BEGIN');
      await client.query("SELECT set_config('app.shop_id', $1, true)", [a]);
      const inside = await client.query<{ id: string }>('SELECT id::text AS id FROM public.shops');
      await client.query('COMMIT');
      expect(inside.rows).toEqual([{ id: a }]);

      const after = await client.query('SELECT id FROM public.shops');
      expect(after.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('NEG-009: permessi su shops: app_user SELECT e UPDATE delle sole colonne dei dati, app_worker solo SELECT, app_jobs nulla', async () => {
    for (const role of ['app_user', 'app_worker']) {
      expect(await tablePrivileges(role, 'public.shops'), role).toEqual({ ...NO_PRIVILEGES, select: true });
    }
    expect(await tablePrivileges('app_jobs', 'public.shops')).toEqual(NO_PRIVILEGES);

    const columns = await owner().query<{ column_name: string; app_user: boolean; app_worker: boolean }>(
      `SELECT column_name,
              has_column_privilege('app_user', 'public.shops', column_name, 'UPDATE') AS app_user,
              has_column_privilege('app_worker', 'public.shops', column_name, 'UPDATE') AS app_worker
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shops'`,
    );
    for (const row of columns.rows) {
      expect(row.app_user, `app_user UPDATE ${row.column_name}`).toBe(DATA_COLUMNS.includes(row.column_name));
      expect(row.app_worker, `app_worker UPDATE ${row.column_name}`).toBe(false);
    }
  });

  it('NEG-009: con il contesto del negozio, app_user non può inserire né cancellare negozi', async () => {
    const a = await createShop();
    expect(
      await errorCode(
        asRole('app', a, (c) =>
          c.query('INSERT INTO public.shops (id, name, subdomain) VALUES ($1, $2, $3)', [
            randomUUID(),
            'Negozio abusivo',
            sub('abusivo'),
          ]),
        ),
      ),
    ).toBe('42501');
    expect(await errorCode(asRole('app', a, (c) => c.query('DELETE FROM public.shops WHERE id = $1', [a])))).toBe(
      '42501',
    );
  });

  it('NEG-009: app_user non può modificare id, subdomain, is_test, created_at né le colonne di stato', async () => {
    const a = await createShop();
    const forbidden = [
      'is_test = true',
      `subdomain = '${sub('nuovo')}'`,
      'id = uuidv7()',
      'created_at = now()',
      "status = 'active'",
      'status_changed_at = now()',
      'grace_started_at = now()',
      'closed_at = now()',
      'reopened_at = now()',
      'trial_inactivity_warned_at = now()',
      'purge_requested_at = now()',
      'purge_notice_sent_at = now()',
      'last_activity_at = now()',
    ];
    for (const assignment of forbidden) {
      expect(
        await errorCode(asRole('app', a, (c) => c.query(`UPDATE public.shops SET ${assignment} WHERE id = $1`, [a]))),
        assignment,
      ).toBe('42501');
    }
  });

  it('NEG-009: app_user modifica i dati del proprio negozio; con il contesto di A una modifica di B tocca 0 righe', async () => {
    const a = await createShop();
    const b = await createShop(sub('neg-t01-b'), 'Negozio B');
    const updated = await asRole('app', a, (c) =>
      c.query(
        `UPDATE public.shops
            SET name = $2, legal_name = $3, vat_number = $4, tax_code = $5, sdi_code = $6, pec = $7, address = $8::jsonb
          WHERE id = $1`,
        [
          a,
          'Negozio A rinominato',
          'Negozio A S.r.l.',
          '12345678901',
          '12345678901',
          'M5UXCR1',
          'negozio.a@pec.it',
          JSON.stringify({ street: 'Via Po 2', city: 'Torino', zip: '10123', province: 'TO', country: 'IT' }),
        ],
      ),
    );
    expect(updated.rowCount).toBe(1);
    const other = await asRole('app', a, (c) =>
      c.query('UPDATE public.shops SET name = $2 WHERE id = $1', [b, 'Modifica non permessa']),
    );
    expect(other.rowCount).toBe(0);

    const names = await owner().query<{ id: string; name: string }>(
      'SELECT id::text AS id, name FROM public.shops WHERE id = ANY($1::uuid[]) ORDER BY name',
      [[a, b]],
    );
    expect(names.rows).toEqual([
      { id: a, name: 'Negozio A rinominato' },
      { id: b, name: 'Negozio B' },
    ]);
  });

  it('NEG-009: app_worker legge il proprio negozio ma non lo inserisce, non lo modifica e non lo cancella', async () => {
    const a = await createShop();
    const seen = await asRole('worker', a, (c) => c.query<{ id: string }>('SELECT id::text AS id FROM public.shops'));
    expect(seen.rows).toEqual([{ id: a }]);
    const statements: Array<[string, unknown[]]> = [
      ['INSERT INTO public.shops (name, subdomain) VALUES ($1, $2)', ['Negozio dal worker', sub('worker')]],
      ['UPDATE public.shops SET name = $2 WHERE id = $1', [a, 'Nome dal worker']],
      ['DELETE FROM public.shops WHERE id = $1', [a]],
    ];
    for (const [text, values] of statements) {
      expect(await errorCode(asRole('worker', a, (c) => c.query(text, values))), text).toBe('42501');
    }
  });
});

describe('audit_log → shops', () => {
  it('NEG-013: audit_log.shop_id fa riferimento a shops(id) con ON DELETE CASCADE', async () => {
    const result = await owner().query(
      `SELECT confrelid::regclass::text AS target, confdeltype AS on_delete,
              (SELECT array_agg(attname ORDER BY attname) FROM pg_attribute
                WHERE attrelid = conrelid AND attnum = ANY(conkey)) AS columns
         FROM pg_constraint WHERE conrelid = 'public.audit_log'::regclass AND contype = 'f'`,
    );
    expect(result.rows).toEqual([{ target: 'shops', on_delete: 'c', columns: ['shop_id'] }]);
  });

  it('NEG-013: una riga di registro di un negozio inesistente è rifiutata, anche con il suo contesto', async () => {
    const missing = randomUUID();
    expect(
      await errorCode(
        asRole('app', missing, (c) =>
          c.query("INSERT INTO public.audit_log (shop_id, actor_type, action) VALUES ($1, 'system', $2)", [
            missing,
            TEST_ACTION,
          ]),
        ),
      ),
    ).toBe('23503');
  });

  it('NEG-013: cancellando un negozio si cancellano le sue righe di registro', async () => {
    const a = await createShop();
    await asRole('app', a, (c) =>
      c.query("INSERT INTO public.audit_log (shop_id, actor_type, action) VALUES ($1, 'system', $2)", [a, TEST_ACTION]),
    );
    const count = () =>
      owner()
        .query<{ n: number }>('SELECT count(*)::int AS n FROM public.audit_log WHERE shop_id = $1', [a])
        .then((result) => result.rows[0]?.n);
    expect(await count()).toBe(1);
    await owner().query('DELETE FROM public.shops WHERE id = $1', [a]);
    expect(await count()).toBe(0);
  });
});

describe('platform_config', () => {
  it('NEG-012: app_user, app_worker e app_jobs non hanno permessi su platform_config', async () => {
    for (const role of ['app_user', 'app_worker', 'app_jobs']) {
      expect(await tablePrivileges(role, 'public.platform_config'), role).toEqual(NO_PRIVILEGES);
    }
    for (const role of ['app', 'worker'] as const) {
      expect(await errorCode(rolePool(role).query('SELECT key FROM public.platform_config')), role).toBe('42501');
    }
  });

  it('NEG-006: platform_config_get() è SECURITY DEFINER di app_owner, STABLE, con search_path fisso, eseguibile solo da app_user e app_worker', async () => {
    const fn = await owner().query(
      `SELECT prosecdef AS definer, pg_get_userbyid(proowner) AS owner, proconfig AS config,
              provolatile AS volatility, pg_get_function_result(oid) AS result, proacl IS NOT NULL AS has_acl,
              EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0) AS public_execute
         FROM pg_proc WHERE oid = 'public.platform_config_get()'::regprocedure`,
    );
    expect(fn.rows).toEqual([
      {
        definer: true,
        owner: 'app_owner',
        config: ['search_path=public, pg_temp'],
        volatility: 's',
        result: 'TABLE(key text, value jsonb)',
        has_acl: true,
        public_execute: false,
      },
    ]);
    const execute = await owner().query<{ role: string; allowed: boolean }>(
      `SELECT r AS role, has_function_privilege(r, 'public.platform_config_get()', 'EXECUTE') AS allowed
         FROM unnest(ARRAY['app_user', 'app_worker', 'app_jobs']) AS r ORDER BY r`,
    );
    expect(execute.rows).toEqual([
      { role: 'app_jobs', allowed: false },
      { role: 'app_user', allowed: true },
      { role: 'app_worker', allowed: true },
    ]);
  });

  it('NEG-006: platform_config_get(), eseguita da app_user e da app_worker, restituisce i valori di src/config/platform.ts', async () => {
    for (const role of ['app', 'worker'] as const) {
      const result = await rolePool(role).query<{ key: string; value: unknown }>(
        'SELECT key, value FROM public.platform_config_get()',
      );
      const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
      for (const [key, value] of Object.entries(EXPECTED_CONFIG)) {
        expect(values[key], `${role}: ${key}`).toEqual(value);
      }
    }
  });

  it('NEG-006: syncPlatformConfig scrive le coppie ricevute, sostituisce un valore già presente e non toglie le altre chiavi', async () => {
    const key = `test.neg-t01.${randomUUID()}`;
    const read = async () =>
      (await owner().query<{ value: unknown }>('SELECT value FROM public.platform_config WHERE key = $1', [key])).rows;
    const connection = createOwnerConnection(testDatabaseUrl('owner'));
    try {
      await syncPlatformConfig(connection.db, [{ key, value: 1 }]);
      expect(await read()).toEqual([{ value: 1 }]);
      await syncPlatformConfig(connection.db, [{ key, value: 'due' }]);
      expect(await read()).toEqual([{ value: 'due' }]);
    } finally {
      await connection.close();
    }
    const kept = await owner().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM public.platform_config WHERE key = ANY($1::text[])',
      [Object.keys(EXPECTED_CONFIG)],
    );
    expect(kept.rows[0]?.n).toBe(Object.keys(EXPECTED_CONFIG).length);
  });

  it('NEG-006: runMigrations riscrive platform_config dal file: un valore cambiato a mano torna quello di platform.ts', async () => {
    try {
      await owner().query("UPDATE public.platform_config SET value = '1'::jsonb WHERE key = 'graceDays'");
      await runMigrations(testDatabaseUrl('owner'));
      const result = await owner().query<{ value: unknown }>(
        "SELECT value FROM public.platform_config WHERE key = 'graceDays'",
      );
      expect(result.rows).toEqual([{ value: platform.graceDays }]);
    } finally {
      await owner().query("UPDATE public.platform_config SET value = $1::jsonb WHERE key = 'graceDays'", [
        JSON.stringify(platform.graceDays),
      ]);
    }
  });
});
