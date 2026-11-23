// Lettura del catalogo per i test di separazione e dei permessi (02 NEG-T05, note (4) e (6) del piano): i permessi
// effettivi dei ruoli di runtime su tabelle, colonne e schemi, e le colonne delle tabelle. I permessi si leggono da
// pg_class.relacl, pg_attribute.attacl e pg_namespace.nspacl con aclexplode (le viste di information_schema mostrano
// solo gli oggetti su cui il ruolo corrente ha permessi), contando le voci concesse al ruolo, a PUBLIC e ai ruoli di cui
// il ruolo è membro; le voci dei ruoli che sono il proprietario dell'oggetto, o ne ereditano i permessi, non contano: il
// proprietario ha comunque ogni permesso, e quei ruoli li segnala il controllo dei proprietari, che legge ownedObjects
// (nota (10)(a)). Ogni permesso riporta anche se è concedibile (WITH GRANT OPTION, nota (10)(b)).
import type { Pool, PoolClient } from 'pg';

/** Il client del proprietario dei test: il pool, oppure una connessione presa dal pool per una transazione. */
export type CatalogClient = Pool | PoolClient;

/** I ruoli di runtime (00 §6). */
export const RUNTIME_ROLES = ['app_user', 'app_worker', 'app_jobs'] as const;
export type RuntimeRoleName = (typeof RUNTIME_ROLES)[number];

/** Le relazioni che contano come tabelle: tabelle, tabelle partizionate, viste, viste materializzate, tabelle esterne. */
const TABLE_KINDS = "('r', 'p', 'v', 'm', 'f')";

/**
 * La voce di aclexplode vale per il ruolo `r.role` se è concessa a PUBLIC (grantee 0) o a un ruolo di cui è membro
 * (compreso sé stesso). Un CASE e non un OR: SQL non garantisce l'ordine, e pg_has_role con l'oid 0 fallirebbe.
 */
const GRANTED_TO_ROLE = "CASE WHEN a.grantee = 0 THEN true ELSE pg_has_role(r.role, a.grantee, 'USAGE') END";

/** Un permesso effettivo: sulla tabella (`column` null) o su una sua colonna. */
export interface TableGrant {
  table: string;
  role: string;
  privilege: string;
  column: string | null;
  /** Vero se il ruolo può concederlo ad altri (WITH GRANT OPTION). */
  grantable: boolean;
}

/** Le tabelle dello schema, per nome. */
export async function tablesOf(client: CatalogClient, schema: string): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    `SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ${TABLE_KINDS} ORDER BY 1`,
    [schema],
  );
  return result.rows.map((row) => row.name);
}

/** I permessi effettivi dei ruoli indicati sulle tabelle dello schema e sulle loro colonne. */
export async function effectiveTableGrants(
  client: CatalogClient,
  schema: string,
  roles: readonly string[] = RUNTIME_ROLES,
): Promise<TableGrant[]> {
  const result = await client.query<TableGrant>(
    `WITH roles(role) AS (SELECT unnest($2::text[]))
     SELECT DISTINCT c.relname::text AS "table", r.role, a.privilege_type AS privilege, NULL::text AS "column",
            a.is_grantable AS grantable
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a
       JOIN roles r ON ${GRANTED_TO_ROLE}
      WHERE n.nspname = $1 AND c.relkind IN ${TABLE_KINDS} AND NOT pg_has_role(r.role, c.relowner, 'USAGE')
     UNION
     SELECT DISTINCT c.relname::text, r.role, a.privilege_type, att.attname::text, a.is_grantable
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
      CROSS JOIN LATERAL aclexplode(att.attacl) a
       JOIN roles r ON ${GRANTED_TO_ROLE}
      WHERE n.nspname = $1 AND c.relkind IN ${TABLE_KINDS} AND NOT pg_has_role(r.role, c.relowner, 'USAGE')
     ORDER BY 1, 2, 3, 4`,
    [schema, roles],
  );
  return result.rows;
}

/** Un permesso effettivo su uno schema. */
export interface SchemaGrant {
  schema: string;
  role: string;
  privilege: string;
  /** Vero se il ruolo può concederlo ad altri (WITH GRANT OPTION). */
  grantable: boolean;
}

/** I permessi effettivi dei ruoli indicati sugli schemi indicati (solo gli schemi che esistono). */
export async function effectiveSchemaGrants(
  client: CatalogClient,
  schemas: readonly string[],
  roles: readonly string[] = RUNTIME_ROLES,
): Promise<SchemaGrant[]> {
  const result = await client.query<SchemaGrant>(
    `WITH roles(role) AS (SELECT unnest($2::text[]))
     SELECT DISTINCT n.nspname::text AS schema, r.role, a.privilege_type AS privilege, a.is_grantable AS grantable
       FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(n.nspacl) a
       JOIN roles r ON ${GRANTED_TO_ROLE}
      WHERE n.nspname = ANY($1::text[]) AND NOT pg_has_role(r.role, n.nspowner, 'USAGE')
      ORDER BY 1, 2, 3`,
    [schemas, roles],
  );
  return result.rows;
}

/** Un oggetto di cui il ruolo è il proprietario, o membro del proprietario: lo schema (`relation` null) o una relazione. */
export interface OwnedObject {
  schema: string;
  relation: string | null;
  role: string;
  owner: string;
}

/**
 * Gli schemi indicati, e le loro relazioni di qualunque tipo, di cui un ruolo indicato è il proprietario o un membro del
 * proprietario (`MEMBER`: ne eredita i permessi o può diventarlo con SET ROLE).
 */
export async function ownedObjects(
  client: CatalogClient,
  schemas: readonly string[],
  roles: readonly string[] = RUNTIME_ROLES,
): Promise<OwnedObject[]> {
  const result = await client.query<OwnedObject>(
    `WITH roles(role) AS (SELECT unnest($2::text[]))
     SELECT n.nspname::text AS schema, NULL::text AS relation, r.role, pg_get_userbyid(n.nspowner)::text AS owner
       FROM pg_namespace n
       JOIN roles r ON pg_has_role(r.role, n.nspowner, 'MEMBER')
      WHERE n.nspname = ANY($1::text[])
     UNION ALL
     SELECT n.nspname::text, c.relname::text, r.role, pg_get_userbyid(c.relowner)::text
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN roles r ON pg_has_role(r.role, c.relowner, 'MEMBER')
      WHERE n.nspname = ANY($1::text[])
     ORDER BY 1, 2 NULLS FIRST, 3`,
    [schemas, roles],
  );
  return result.rows;
}

/** Gli schemi indicati che esistono. */
export async function existingSchemas(client: CatalogClient, schemas: readonly string[]): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    'SELECT nspname::text AS name FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY 1',
    [schemas],
  );
  return result.rows.map((row) => row.name);
}

/** Una colonna di una tabella, con il tipo come lo scrive PostgreSQL e se si può scrivere in un INSERT. */
export interface ColumnInfo {
  name: string;
  type: string;
  /** Falso per le colonne generate e le identità `GENERATED ALWAYS`, che un INSERT non può valorizzare. */
  writable: boolean;
}

/** Le colonne non cancellate di una tabella di `public`, nell'ordine della tabella. */
export async function columnsOf(client: CatalogClient, table: string): Promise<ColumnInfo[]> {
  const result = await client.query<ColumnInfo>(
    `SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type,
            (a.attgenerated = '' AND a.attidentity <> 'a') AS writable
       FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || quote_ident($1)) AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [table],
  );
  return result.rows;
}
