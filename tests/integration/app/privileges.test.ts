import { afterAll, describe, expect, it } from 'vitest';
import { SCHEMA_PRIVILEGES, TABLE_PRIVILEGES } from '@/server/db/isolation/privileges.allowlist';
import {
  type CatalogClient,
  effectiveSchemaGrants,
  effectiveTableGrants,
  existingSchemas,
  RUNTIME_ROLES,
  type TableGrant,
  tablesOf,
} from '../../fixtures/catalog';
import { closeRolePools, rolePool } from '../../fixtures/db';

// Test dei permessi NEG-012 (02 NEG-012 e NEG-T05, note (3)–(5) del piano; 00 R-DATI-4): i permessi effettivi di
// app_user, app_worker e app_jobs su ogni tabella dello schema public, sulle sue colonne e sugli schemi public e pgboss
// coincidono con l'elenco consentito di src/server/db/isolation/privileges.allowlist.ts, che usa anche isolation-check
// (BIL-T09). Una tabella esistente senza voce nell'elenco fa fallire; una voce per una tabella che non esiste ancora è
// ammessa. Le tabelle di pgboss (proprietario app_jobs) non danno permessi ad app_user e app_worker. Il controllo è una
// funzione che riceve un client, provata anche sul caso che deve fallire, in una transazione del proprietario annullata.

const owner = () => rolePool('owner');

afterAll(async () => {
  await closeRolePools();
});

const grantKey = (grant: Pick<TableGrant, 'table' | 'role' | 'privilege' | 'column'>) =>
  `${grant.table} ${grant.role} ${grant.privilege}${grant.column === null ? '' : ` (${grant.column})`}`;

/** Il controllo di NEG-012 sul catalogo visto dal client: l'elenco delle differenze, vuoto se tutto corrisponde. */
async function checkPrivileges(client: CatalogClient): Promise<string[]> {
  const violations: string[] = [];

  const tables = await tablesOf(client, 'public');
  const listed = new Set<string>();
  const expected = new Set<string>();
  for (const table of tables) {
    const entry = TABLE_PRIVILEGES[table];
    if (entry === undefined) {
      violations.push(`${table}: tabella senza voce nell'elenco consentito`);
      continue;
    }
    listed.add(table);
    for (const role of RUNTIME_ROLES) {
      const grants = entry[role];
      for (const privilege of grants?.table ?? []) {
        expected.add(grantKey({ table, role, privilege, column: null }));
      }
      for (const [privilege, columns] of Object.entries(grants?.columns ?? {})) {
        for (const column of columns ?? []) expected.add(grantKey({ table, role, privilege, column }));
      }
    }
  }
  const actual = new Set(
    (await effectiveTableGrants(client, 'public')).filter((grant) => listed.has(grant.table)).map(grantKey),
  );
  for (const grant of actual) if (!expected.has(grant)) violations.push(`${grant}: permesso in più`);
  for (const grant of expected) if (!actual.has(grant)) violations.push(`${grant}: permesso mancante`);

  const schemas = await existingSchemas(client, Object.keys(SCHEMA_PRIVILEGES));
  const expectedSchemas = new Set(
    schemas.flatMap((schema) =>
      RUNTIME_ROLES.flatMap((role) =>
        (SCHEMA_PRIVILEGES[schema]?.[role] ?? []).map((privilege) => `schema ${schema} ${role} ${privilege}`),
      ),
    ),
  );
  const actualSchemas = new Set(
    (await effectiveSchemaGrants(client, schemas)).map((g) => `schema ${g.schema} ${g.role} ${g.privilege}`),
  );
  for (const grant of actualSchemas) if (!expectedSchemas.has(grant)) violations.push(`${grant}: permesso in più`);
  for (const grant of expectedSchemas) if (!actualSchemas.has(grant)) violations.push(`${grant}: permesso mancante`);

  for (const grant of await effectiveTableGrants(client, 'pgboss', ['app_user', 'app_worker'])) {
    violations.push(`pgboss.${grantKey(grant)}: permesso in più`);
  }
  return violations;
}

describe('permessi dei ruoli di runtime', () => {
  it('NEG-012: i permessi effettivi di app_user, app_worker e app_jobs su tabelle e colonne di public, sugli schemi public e pgboss e sulle tabelle di pgboss coincidono con l’elenco consentito', async () => {
    expect(await checkPrivileges(owner())).toEqual([]);
  });

  it('NEG-012: la lettura del catalogo vede le tabelle di oggi, lo schema pgboss e i permessi per colonna (controllo positivo)', async () => {
    const tables = await tablesOf(owner(), 'public');
    expect(tables).toEqual(expect.arrayContaining(['audit_log', 'email_suppressions', 'platform_config', 'shops']));
    for (const table of ['audit_log', 'email_suppressions', 'platform_config', 'shops']) {
      expect(TABLE_PRIVILEGES, table).toHaveProperty(table);
    }
    expect(await existingSchemas(owner(), ['public', 'pgboss'])).toEqual(['pgboss', 'public']);
    const grants = (await effectiveTableGrants(owner(), 'public')).map(grantKey);
    expect(grants).toEqual(
      expect.arrayContaining(['shops app_user UPDATE (name)', 'audit_log app_worker INSERT', 'shops app_user SELECT']),
    );
    expect(grants.filter((grant) => grant.split(' ')[1] === 'app_jobs')).toEqual([]);
  });

  it('NEG-012: il controllo segnala un permesso in più, un permesso mancante, una tabella senza voce e un permesso in più sullo schema', async () => {
    const client = await owner().connect();
    try {
      await client.query('BEGIN');
      await client.query('GRANT DELETE ON public.audit_log TO app_user');
      await client.query('REVOKE INSERT ON public.audit_log FROM app_worker');
      await client.query('CREATE TABLE public.neg_t05_senza_voce (x int)');
      await client.query('GRANT CREATE ON SCHEMA public TO app_worker');
      const violations = await checkPrivileges(client);
      expect(violations).toEqual(
        expect.arrayContaining([
          'audit_log app_user DELETE: permesso in più',
          'audit_log app_worker INSERT: permesso mancante',
          "neg_t05_senza_voce: tabella senza voce nell'elenco consentito",
          'schema public app_worker CREATE: permesso in più',
        ]),
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    // Il catalogo condiviso non conserva nulla della prova.
    expect(await checkPrivileges(owner())).toEqual([]);
  });
});
