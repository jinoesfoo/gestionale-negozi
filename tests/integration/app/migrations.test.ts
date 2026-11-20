import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/migrate';
import { closeRolePools, rolePool, testDatabaseUrl } from '../../fixtures/db';

// FON-004: le migrazioni sono ripetibili senza effetti su un database già aggiornato. Sul database di test già migrato
// (pnpm db:migrate, in CI un passo prima di test:int) si rieseguono con il migratore di src/migrate.ts e le credenziali
// del proprietario, e si confrontano prima e dopo lo schema public letto dal catalogo e il registro delle migrazioni.
// Niente pg_dump: sui due computer non c'è, e dalla gabbia Docker non si raggiunge.

const root = join(import.meta.dirname, '..', '..', '..');

afterAll(async () => {
  await closeRolePools();
});

/** Le parti dello schema public che una migrazione può cambiare, in un ordine stabile. */
const CATALOG: Record<string, string> = {
  schemi: `
    SELECT nspname, nspowner::regrole::text AS owner, coalesce(nspacl::text[], '{}') AS acl
      FROM pg_namespace WHERE nspname IN ('public', 'drizzle') ORDER BY nspname`,
  permessiPredefiniti: `
    SELECT defaclrole::regrole::text AS role,
           CASE WHEN defaclnamespace = 0 THEN '' ELSE defaclnamespace::regnamespace::text END AS schema,
           defaclobjtype AS objtype, defaclacl::text[] AS acl
      FROM pg_default_acl ORDER BY 1, 2, 3`,
  relazioni: `
    SELECT c.relname, c.relkind, c.relowner::regrole::text AS owner, c.relrowsecurity, c.relforcerowsecurity,
           coalesce(c.relacl::text[], '{}') AS acl
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace ORDER BY c.relname`,
  colonne: `
    SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr, a.attidentity, a.attgenerated,
           coalesce(a.attacl::text[], '{}') AS acl
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attname`,
  vincoli: `
    SELECT conrelid::regclass::text AS rel, conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`,
  indici: `
    SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`,
  funzioni: `
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prokind,
           CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) END AS def,
           p.proowner::regrole::text AS owner, p.prosecdef, coalesce(p.proconfig, '{}') AS config,
           coalesce(p.proacl::text[], '{}') AS acl
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1, 2`,
  trigger: `
    SELECT t.tgrelid::regclass::text AS rel, t.tgname, pg_get_triggerdef(t.oid) AS def, t.tgenabled
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal ORDER BY 1, 2`,
  policy: `
    SELECT tablename, policyname, permissive, roles::text[] AS roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`,
  registroMigrazioni: `
    SELECT id, hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
};

async function readCatalog(pool: Pool): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [part, query] of Object.entries(CATALOG)) {
    out[part] = (await pool.query(query)).rows;
  }
  return out;
}

describe('migrazioni', () => {
  it('FON-004: rieseguite su un database già aggiornato terminano con successo e non cambiano lo schema', async () => {
    const owner = rolePool('owner');
    const journal = JSON.parse(readFileSync(join(root, 'drizzle', 'meta', '_journal.json'), 'utf8')) as {
      entries: unknown[];
    };
    const applied = await owner.query<{ n: string }>('SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations');
    expect(
      Number(applied.rows[0]?.n),
      'il database di test non è aggiornato: esegui prima pnpm db:migrate (nella gabbia)',
    ).toBe(journal.entries.length);

    const before = await readCatalog(owner);
    await expect(runMigrations(testDatabaseUrl('owner'))).resolves.toBeUndefined();
    const after = await readCatalog(owner);

    expect(after).toEqual(before);
  });
});
