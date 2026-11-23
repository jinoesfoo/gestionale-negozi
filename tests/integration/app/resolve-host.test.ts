import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { resolveHost } from '@/server/db/resolve-host';
import { closeRolePools, rolePool } from '../../fixtures/db';

// resolve_host (02 §Funzioni di piattaforma: "(shop_id uuid, subdomain text, shop_status text, name text) per gli host
// <sub>.{{DOMINIO}}; nessuna riga se sconosciuto", U) e il suo wrapper resolveHost per il proxy di NEG-T04 (NEG-T02,
// note (4) e (5) del piano). NEG-006 chiede al compito che crea la funzione un test che esiste e si comporta come
// descritto. In .env.test PUBLIC_BASE_DOMAIN vale localhost. I negozi li crea il proprietario e li cancella alla fine;
// i casi closed e is_test si provano in una transazione annullata del proprietario (nota (8) di NEG-T01: nel database
// condiviso non restano negozi fuori da trial), perché il risultato di una funzione SECURITY DEFINER non dipende da chi
// la chiama.

const FUNCTION = 'public.resolve_host(text)';
const owner = () => rolePool('owner');
const created: string[] = [];

afterAll(async () => {
  await owner().query('DELETE FROM public.shops WHERE id = ANY($1::uuid[])', [created]);
  await closeDb();
  await closeRolePools();
});

const newSubdomain = () => `neg-t02-h-${randomUUID().slice(0, 8)}`;

async function createShop(name: string, subdomain = newSubdomain()): Promise<{ id: string; subdomain: string }> {
  const result = await owner().query<{ id: string }>(
    'INSERT INTO public.shops (name, subdomain) VALUES ($1, $2) RETURNING id::text AS id',
    [name, subdomain],
  );
  const id = result.rows[0]!.id;
  created.push(id);
  return { id, subdomain };
}

async function errorOf(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return { code, message };
  }
  throw new Error('la promessa doveva fallire');
}

describe('resolve_host', () => {
  it('NEG-006: resolve_host è SECURITY DEFINER di app_owner, LANGUAGE sql, STABLE, con search_path fisso, restituisce anche name ed è eseguibile solo da app_user', async () => {
    const fn = await owner().query(
      `SELECT prosecdef AS definer, pg_get_userbyid(proowner) AS owner, proconfig AS config, provolatile AS volatility,
              (SELECT l.lanname FROM pg_language l WHERE l.oid = prolang)::text AS language,
              pg_get_function_result(oid) AS result, proacl IS NOT NULL AS has_acl
         FROM pg_proc WHERE oid = to_regprocedure($1)`,
      [FUNCTION],
    );
    expect(fn.rows).toEqual([
      {
        definer: true,
        owner: 'app_owner',
        config: ['search_path=public, pg_temp'],
        volatility: 's',
        language: 'sql',
        result: 'TABLE(shop_id uuid, subdomain text, shop_status text, name text)',
        has_acl: true,
      },
    ]);
    const grants = await owner().query<{ entry: string }>(
      `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END || ' ' ||
              a.privilege_type || CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END AS entry
         FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
         LEFT JOIN pg_roles r ON r.oid = a.grantee
        WHERE p.oid = to_regprocedure($1) AND a.grantee <> p.proowner AND NOT coalesce(r.rolsuper, false)`,
      [FUNCTION],
    );
    expect(grants.rows.map((row) => row.entry)).toEqual(['app_user EXECUTE']);
  });

  it('NEG-006: eseguita da app_user, restituisce shop_id, subdomain, shop_status e name del negozio del sottodominio', async () => {
    const shop = await createShop('Negozio Host NEG-T02');
    const query = 'SELECT shop_id::text AS shop_id, subdomain, shop_status, name FROM public.resolve_host($1)';
    const expected = [
      { shop_id: shop.id, subdomain: shop.subdomain, shop_status: 'trial', name: 'Negozio Host NEG-T02' },
    ];

    const app = rolePool('app');
    expect((await app.query(query, [`${shop.subdomain}.localhost`])).rows).toEqual(expected);
    expect((await app.query(query, [`${shop.subdomain.toUpperCase()}.LOCALHOST`])).rows).toEqual(expected);
    expect((await app.query(query, [`assente-${randomUUID().slice(0, 8)}.localhost`])).rows).toEqual([]);
    expect((await app.query(query, [shop.subdomain])).rows).toEqual([]);
  });

  it('NEG-006: restituisce anche un negozio closed e un negozio is_test (prova del proprietario in una transazione annullata)', async () => {
    const shop = await createShop('Negozio Chiuso NEG-T02');
    const client = await owner().connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE public.shops SET status = 'closed', closed_at = now(), is_test = true WHERE id = $1", [
        shop.id,
      ]);
      const rows = await client.query('SELECT shop_id::text AS shop_id, shop_status FROM public.resolve_host($1)', [
        `${shop.subdomain}.localhost`,
      ]);
      expect(rows.rows).toEqual([{ shop_id: shop.id, shop_status: 'closed' }]);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('NEG-006: app_worker e app_jobs non possono eseguire resolve_host', async () => {
    // app_worker ha USAGE sullo schema public: lo ferma il permesso EXECUTE della funzione.
    const worker = await errorOf(rolePool('worker').query('SELECT * FROM public.resolve_host($1)', ['x.localhost']));
    expect(worker).toMatchObject({ code: '42501' });
    expect(worker.message).toMatch(/^permission denied for function resolve_host/);
    // app_jobs non ha USAGE sullo schema public (FON-003, infra/postgres/roles.sql.tpl): PostgreSQL lo ferma già quando
    // risolve il nome con lo schema, prima di guardare EXECUTE. Il permesso sulla funzione si legge dal catalogo, per i
    // tre ruoli di runtime (has_function_privilege conta anche i permessi ereditati da un altro ruolo).
    const jobs = await errorOf(rolePool('jobs').query('SELECT * FROM public.resolve_host($1)', ['x.localhost']));
    expect(jobs).toMatchObject({ code: '42501' });
    expect(jobs.message).toMatch(/^permission denied for schema public/);
    const execute = await owner().query<{ role: string; allowed: boolean }>(
      `SELECT r AS role, has_function_privilege(r, $1, 'EXECUTE') AS allowed
         FROM unnest(ARRAY['app_user', 'app_worker', 'app_jobs']) AS r ORDER BY r`,
      [FUNCTION],
    );
    expect(execute.rows).toEqual([
      { role: 'app_jobs', allowed: false },
      { role: 'app_user', allowed: true },
      { role: 'app_worker', allowed: false },
    ]);
  });
});

describe('resolveHost', () => {
  it('NEG-006: resolveHost restituisce { shopId, subdomain, status, name } per <sottodominio>.<PUBLIC_BASE_DOMAIN> e null per un host sconosciuto o fuori dominio', async () => {
    const shop = await createShop('Negozio Wrapper NEG-T02');
    await expect(resolveHost(`${shop.subdomain}.localhost:3000`)).resolves.toEqual({
      shopId: shop.id,
      subdomain: shop.subdomain,
      status: 'trial',
      name: 'Negozio Wrapper NEG-T02',
    });
    await expect(resolveHost(`assente-${randomUUID().slice(0, 8)}.localhost`)).resolves.toBeNull();
    await expect(resolveHost(`${shop.subdomain}.altro.example`)).resolves.toBeNull();
  });

  it('NEG-010: resolveHost tiene la cache fra una chiamata e l’altra: un negozio trovato resta quello letto, un host vuoto resta vuoto', async () => {
    const shop = await createShop('Negozio Cache NEG-T02');
    const host = `${shop.subdomain}.localhost`;
    const byFunction = async (target: string) =>
      (await rolePool('app').query<{ name: string }>('SELECT name FROM public.resolve_host($1)', [target])).rows;

    await expect(resolveHost(host)).resolves.toMatchObject({ shopId: shop.id, name: 'Negozio Cache NEG-T02' });
    const renamed = await owner().query('UPDATE public.shops SET name = $1 WHERE id = $2', [
      'Negozio Rinominato NEG-T02',
      shop.id,
    ]);
    expect(renamed.rowCount).toBe(1);
    // Il database vede già il nome nuovo: il nome vecchio può venire solo dalla cache (60 s).
    expect(await byFunction(host)).toEqual([{ name: 'Negozio Rinominato NEG-T02' }]);
    await expect(resolveHost(host)).resolves.toMatchObject({ shopId: shop.id, name: 'Negozio Cache NEG-T02' });

    const later = newSubdomain();
    await expect(resolveHost(`${later}.localhost`)).resolves.toBeNull();
    await createShop('Negozio Tardivo NEG-T02', later);
    expect(await byFunction(`${later}.localhost`)).toEqual([{ name: 'Negozio Tardivo NEG-T02' }]);
    // Entro i 10 s dei risultati vuoti il negozio appena creato non si vede ancora.
    await expect(resolveHost(`${later}.localhost`)).resolves.toBeNull();
  });
});
