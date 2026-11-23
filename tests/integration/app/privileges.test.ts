import { afterAll, describe, expect, it } from 'vitest';
import { SCHEMA_PRIVILEGES, TABLE_PRIVILEGES } from '@/server/db/isolation/privileges.allowlist';
import {
  type CatalogClient,
  effectiveSchemaGrants,
  effectiveTableGrants,
  existingSchemas,
  ownedObjects,
  RUNTIME_ROLES,
  type SchemaGrant,
  type TableGrant,
  tablesOf,
} from '../../fixtures/catalog';
import { closeRolePools, rolePool } from '../../fixtures/db';

// Test dei permessi NEG-012 (02 NEG-012 e NEG-T05, note (3)–(5) del piano; 00 R-DATI-4): i permessi effettivi di
// app_user, app_worker e app_jobs su ogni tabella dello schema public, sulle sue colonne e sugli schemi public e pgboss
// coincidono con l'elenco consentito di src/server/db/isolation/privileges.allowlist.ts, che usa anche isolation-check
// (BIL-T09). Una tabella esistente senza voce nell'elenco fa fallire; una voce per una tabella che non esiste ancora è
// ammessa. Le tabelle di pgboss (proprietario app_jobs) non danno permessi ad app_user e app_worker. Nota (10) del piano:
// nessun permesso dei ruoli di runtime è concedibile (WITH GRANT OPTION), e nessun ruolo di runtime è proprietario, o
// membro del proprietario, di public e delle sue relazioni, né (tranne app_jobs) di pgboss e delle sue relazioni. I
// controlli sono funzioni che ricevono un client, provate anche sul caso che deve fallire: in una transazione del
// proprietario annullata, oppure, per i proprietari, con app_owner al posto dei ruoli di runtime, perché app_owner non ha
// CREATEROLE e non può dare un ruolo né cedere un oggetto.

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
  const actualGrants = (await effectiveTableGrants(client, 'public')).filter((grant) => listed.has(grant.table));
  const actual = new Set(actualGrants.map(grantKey));
  for (const grant of actual) if (!expected.has(grant)) violations.push(`${grant}: permesso in più`);
  for (const grant of expected) if (!actual.has(grant)) violations.push(`${grant}: permesso mancante`);
  for (const grant of new Set(actualGrants.filter((g) => g.grantable).map(grantKey))) {
    violations.push(`${grant}: concedibile`);
  }

  const schemas = await existingSchemas(client, Object.keys(SCHEMA_PRIVILEGES));
  const schemaKey = (grant: Pick<SchemaGrant, 'schema' | 'role' | 'privilege'>) =>
    `schema ${grant.schema} ${grant.role} ${grant.privilege}`;
  const expectedSchemas = new Set(
    schemas.flatMap((schema) =>
      RUNTIME_ROLES.flatMap((role) =>
        (SCHEMA_PRIVILEGES[schema]?.[role] ?? []).map((privilege) => schemaKey({ schema, role, privilege })),
      ),
    ),
  );
  const schemaGrants = await effectiveSchemaGrants(client, schemas);
  const actualSchemas = new Set(schemaGrants.map(schemaKey));
  for (const grant of actualSchemas) if (!expectedSchemas.has(grant)) violations.push(`${grant}: permesso in più`);
  for (const grant of expectedSchemas) if (!actualSchemas.has(grant)) violations.push(`${grant}: permesso mancante`);
  for (const grant of new Set(schemaGrants.filter((g) => g.grantable).map(schemaKey))) {
    violations.push(`${grant}: concedibile`);
  }

  for (const grant of await effectiveTableGrants(client, 'pgboss', ['app_user', 'app_worker'])) {
    violations.push(`pgboss.${grantKey(grant)}: permesso in più`);
  }

  violations.push(...(await ownershipViolations(client)));
  return violations;
}

/**
 * I ruoli indicati che sono proprietari, o membri del proprietario, dello schema public o di una sua relazione, oppure
 * dello schema pgboss o di una sua relazione (ammesso solo per app_jobs, che possiede pgboss).
 */
async function ownershipViolations(client: CatalogClient, roles: readonly string[] = RUNTIME_ROLES): Promise<string[]> {
  return (await ownedObjects(client, ['public', 'pgboss'], roles))
    .filter((object) => !(object.schema === 'pgboss' && object.role === 'app_jobs'))
    .map((object) => {
      const name = object.relation === null ? `schema ${object.schema}` : `${object.schema}.${object.relation}`;
      return `${name} ${object.role}: proprietario o membro del proprietario ${object.owner}`;
    });
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
    // La lettura dei proprietari vede app_jobs proprietario di pgboss (il caso ammesso).
    expect(await ownedObjects(owner(), ['pgboss'], ['app_jobs'])).toContainEqual({
      schema: 'pgboss',
      relation: null,
      role: 'app_jobs',
      owner: 'app_jobs',
    });
  });

  it('NEG-012: il controllo segnala un permesso in più, un permesso mancante, una tabella senza voce, un permesso in più sullo schema e i permessi concedibili', async () => {
    const client = await owner().connect();
    try {
      await client.query('BEGIN');
      await client.query('GRANT DELETE ON public.audit_log TO app_user');
      await client.query('REVOKE INSERT ON public.audit_log FROM app_worker');
      await client.query('CREATE TABLE public.neg_t05_senza_voce (x int)');
      await client.query('GRANT CREATE ON SCHEMA public TO app_worker');
      await client.query('GRANT SELECT ON public.audit_log TO app_user WITH GRANT OPTION');
      await client.query('GRANT USAGE ON SCHEMA public TO app_worker WITH GRANT OPTION');
      const violations = await checkPrivileges(client);
      expect(violations).toEqual(
        expect.arrayContaining([
          'audit_log app_user DELETE: permesso in più',
          'audit_log app_worker INSERT: permesso mancante',
          "neg_t05_senza_voce: tabella senza voce nell'elenco consentito",
          'schema public app_worker CREATE: permesso in più',
          'audit_log app_user SELECT: concedibile',
          'schema public app_worker USAGE: concedibile',
        ]),
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    // Il catalogo condiviso non conserva nulla della prova.
    expect(await checkPrivileges(owner())).toEqual([]);
  });

  it('NEG-012: il controllo dei proprietari segnala un ruolo proprietario dello schema public e delle sue tabelle, e non app_jobs proprietario di pgboss', async () => {
    expect(await ownershipViolations(owner(), ['app_owner'])).toEqual(
      expect.arrayContaining([
        'schema public app_owner: proprietario o membro del proprietario app_owner',
        'public.audit_log app_owner: proprietario o membro del proprietario app_owner',
      ]),
    );
    expect(await ownershipViolations(owner(), ['app_jobs'])).toEqual([]);
  });
});
