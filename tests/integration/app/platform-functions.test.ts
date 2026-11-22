import { afterAll, describe, expect, it } from 'vitest';
import { closeRolePools, rolePool } from '../../fixtures/db';

// Test generico NEG-006 (02 NEG-006 e NEG-T02, nota (7) del piano): ogni funzione SECURITY DEFINER dello schema public
// deve essere nell'elenco di 02 §Funzioni di piattaforma, e ogni funzione dell'elenco che esiste deve avere le
// proprietà dell'elenco: SECURITY DEFINER, proprietario app_owner, search_path = public, pg_temp, nessun EXECUTE a
// PUBLIC, e come destinatari espliciti di proacl (esclusi il proprietario e i superuser, che hanno sempre EXECUTE)
// esattamente i ruoli della colonna "Ruoli", senza WITH GRANT OPTION. Una funzione dell'elenco non ancora creata (il suo
// compito è più avanti) è ammessa. Chi aggiunge una funzione all'elenco della specifica la aggiunge anche qui: il test
// fallisce appena la funzione esiste nel database. Le firme si risolvono con to_regprocedure, che accetta anche gli
// alias dei tipi (int, timestamptz). Durante i test di int-app esiste anche la admin_create_shop provvisoria della
// preparazione globale, con le proprietà della funzione vera.

type Role = 'app_user' | 'app_worker';
const U: Role[] = ['app_user'];
const W: Role[] = ['app_worker'];
const UW: Role[] = ['app_user', 'app_worker'];

/** 02 §Funzioni di piattaforma: firma (nome e tipi degli argomenti) e colonna "Ruoli" (U = app_user, W = app_worker). */
const PLATFORM_FUNCTIONS: readonly (readonly [signature: string, roles: Role[]])[] = [
  ['resolve_host(text)', U],
  ['shops_for_user()', U],
  ['shop_touch_activity(uuid)', U],
  ['is_platform_admin(text)', U],
  ['platform_admin_since(text)', U],
  ['admin_enrollment_claim(text)', U],
  ['invitation_lookup(text)', U],
  ['invitation_claim(text)', U],
  ['shop_id_for_stripe_customer(text)', W],
  ['billing_attach_checkout(uuid, text, text)', U],
  ['billing_customer_for_shop(uuid)', U],
  ['billing_apply_state(uuid, jsonb, text, jsonb)', W],
  ['billing_sync_modules(uuid, jsonb)', W],
  ['stripe_event_record(text, text, text)', U],
  ['stripe_events_pending_customers(interval)', W],
  ['stripe_events_set_customer(text, text)', W],
  ['stripe_events_exhausted()', W],
  ['stripe_events_pending(text)', W],
  ['stripe_events_mark(jsonb)', W],
  ['platform_config_get()', UW],
  ['shops_in_billing_sweep()', W],
  ['shops_close_inactive_trials(int)', W],
  ['admin_grant_module(uuid, text, text, timestamptz)', U],
  ['admin_revoke_module(uuid, text)', U],
  ['admin_close_shop(uuid, text)', U],
  ['admin_reopen_shop(uuid)', U],
  ['shops_to_purge(int)', W],
  ['purge_shop(uuid)', W],
  ['trials_ending(int)', W],
  ['admin_create_shop(text, text, text, text, text, text, text, jsonb, boolean)', U],
  ['admin_list_shops(text, int, int)', U],
  ['admin_shop_summary(uuid)', U],
  ['admin_list_sdi_invoices(text, int, int)', U],
  ['admin_list_archived_invoices(text, int, int)', U],
  ['sdi_invoices_pending_status()', W],
  ['sdi_invoices_stale(int)', UW],
  ['two_factor_purge_unverified()', W],
  ['audit_platform(text, text, text, text, text, jsonb, jsonb, inet, text)', UW],
  ['admin_platform_audit(jsonb, int, int)', U],
  ['audit_redact_old_ips(int)', W],
  ['exports_to_expire()', W],
];

/** Le funzioni dei compiti già chiusi (FON-T10, NEG-T01) e di NEG-T02: devono esistere. */
const MUST_EXIST = [
  'audit_platform(text, text, text, text, text, jsonb, jsonb, inet, text)',
  'platform_config_get()',
  'resolve_host(text)',
];

const SIGNATURES = PLATFORM_FUNCTIONS.map(([signature]) => signature);
const owner = () => rolePool('owner');

afterAll(async () => {
  await closeRolePools();
});

/** Firma dell'elenco → oid della funzione nel database, o null se non esiste ancora. */
async function resolveSignatures(): Promise<Map<string, string | null>> {
  const result = await owner().query<{ signature: string; oid: string | null }>(
    `SELECT s AS signature, to_regprocedure('public.' || s)::oid::text AS oid FROM unnest($1::text[]) AS s`,
    [SIGNATURES],
  );
  return new Map(result.rows.map((row) => [row.signature, row.oid]));
}

interface FunctionRow {
  oid: string;
  name: string;
  definer: boolean;
  owner: string;
  config: string[];
  default_acl: boolean;
  grants: string[];
}

/** Proprietà delle funzioni indicate: i permessi espliciti esclusi il proprietario e i superuser, in ordine. */
async function functionProperties(oids: string[]): Promise<FunctionRow[]> {
  const result = await owner().query<FunctionRow>(
    `SELECT p.oid::text AS oid, p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,
            p.prosecdef AS definer, pg_get_userbyid(p.proowner)::text AS owner, coalesce(p.proconfig, '{}') AS config,
            p.proacl IS NULL AS default_acl,
            coalesce((SELECT array_agg(g.entry ORDER BY g.entry)
                        FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
                                     || ' ' || a.privilege_type
                                     || CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END AS entry
                                FROM aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                               WHERE a.grantee <> p.proowner AND NOT coalesce(r.rolsuper, false)) AS g),
                     '{}') AS grants
       FROM pg_proc p WHERE p.oid = ANY($1::oid[])`,
    [oids],
  );
  return result.rows;
}

describe('funzioni di piattaforma', () => {
  it('NEG-006: l’elenco trascritto ha 41 firme distinte, con tipi che esistono in PostgreSQL', async () => {
    expect(new Set(SIGNATURES).size).toBe(41);
    const types = [
      ...new Set(
        SIGNATURES.flatMap((signature) =>
          signature
            .slice(signature.indexOf('(') + 1, -1)
            .split(',')
            .map((type) => type.trim())
            .filter((type) => type !== ''),
        ),
      ),
    ];
    const result = await owner().query<{ type: string }>(
      'SELECT t AS type FROM unnest($1::text[]) AS t WHERE to_regtype(t) IS NULL',
      [types],
    );
    expect(result.rows).toEqual([]);
  });

  it('NEG-006: ogni funzione SECURITY DEFINER di public è nell’elenco, e ogni funzione dell’elenco che esiste ne ha proprietà e ruoli', async () => {
    const resolved = await resolveSignatures();
    const listed = new Map([...resolved].flatMap(([signature, oid]) => (oid === null ? [] : [[oid, signature]])));
    const violations: string[] = [];

    const definers = await owner().query<{ oid: string; name: string }>(
      `SELECT p.oid::text AS oid, p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef ORDER BY 2`,
    );
    for (const row of definers.rows) {
      if (!listed.has(row.oid)) violations.push(`${row.name}: SECURITY DEFINER ma non nell'elenco di 02`);
    }

    const roles = new Map(PLATFORM_FUNCTIONS.map(([signature, list]) => [signature, list]));
    for (const fn of await functionProperties([...listed.keys()])) {
      const signature = listed.get(fn.oid)!;
      const expected = roles
        .get(signature)!
        .map((role) => `${role} EXECUTE`)
        .sort();
      if (!fn.definer) violations.push(`${fn.name}: non è SECURITY DEFINER`);
      if (fn.owner !== 'app_owner') violations.push(`${fn.name}: proprietario ${fn.owner}`);
      if (!fn.config.includes('search_path=public, pg_temp')) {
        violations.push(`${fn.name}: search_path non impostato a public, pg_temp`);
      }
      if (fn.default_acl) violations.push(`${fn.name}: permessi predefiniti (PUBLIC ha EXECUTE)`);
      const grants = [...fn.grants].sort();
      if (JSON.stringify(grants) !== JSON.stringify(expected)) {
        violations.push(`${fn.name}: permessi ${JSON.stringify(grants)} invece di ${JSON.stringify(expected)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('NEG-006: le funzioni dei compiti già chiusi e di NEG-T02 esistono (audit_platform, platform_config_get, resolve_host)', async () => {
    const resolved = await resolveSignatures();
    expect(MUST_EXIST.filter((signature) => resolved.get(signature) === null)).toEqual([]);
  });
});
