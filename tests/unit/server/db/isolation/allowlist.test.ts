import { describe, expect, it } from 'vitest';
import {
  type RoleGrants,
  SCHEMA_PRIVILEGES,
  TABLE_PRIVILEGES,
  type TableAllowlist,
} from '@/server/db/isolation/privileges.allowlist';

// L'elenco consentito (02 NEG-012 e NEG-T05, note (3) e (5) del piano) rispetta le regole dell'accettazione di NEG-012
// per ogni tabella che contiene: il test di integrazione confronta il database con l'elenco, questo controlla che
// l'elenco stesso non conceda ciò che la specifica vieta. Le regole per le tabelle che nasceranno in compiti successivi
// valgono appena la tabella entra nell'elenco.

type Allowlist = Readonly<Record<string, TableAllowlist>>;
const ROLES = ['app_user', 'app_worker', 'app_jobs'] as const;
const WRITES = ['INSERT', 'UPDATE', 'DELETE'];

/** I permessi di un ruolo su una tabella: quelli sulla tabella e quelli per colonna, come elenchi ordinati. */
function grantsOf(allowlist: Allowlist, table: string, role: (typeof ROLES)[number]) {
  const grants: RoleGrants | undefined = allowlist[table]?.[role];
  const onTable = [...(grants?.table ?? [])].sort();
  const onColumns = Object.fromEntries(
    Object.entries(grants?.columns ?? {})
      .filter(([, columns]) => (columns ?? []).length > 0)
      .map(([privilege, columns]) => [privilege, [...(columns ?? [])].sort()]),
  );
  /** Ogni permesso, sulla tabella o su almeno una colonna. */
  const any = [...new Set([...onTable, ...Object.keys(onColumns)])].sort();
  return { onTable, onColumns, any };
}

/** Le violazioni delle regole di NEG-012 nell'elenco dato. */
function allowlistViolations(allowlist: Allowlist): string[] {
  const violations: string[] = [];
  const has = (table: string) => Object.hasOwn(allowlist, table);
  const exactly = (table: string, role: (typeof ROLES)[number], onTable: string[], onColumns = {}) => {
    const actual = grantsOf(allowlist, table, role);
    if (JSON.stringify(actual.onTable) !== JSON.stringify([...onTable].sort())) {
      violations.push(`${table} ${role}: permessi sulla tabella ${actual.onTable.join(', ')}`);
    }
    if (JSON.stringify(actual.onColumns) !== JSON.stringify(onColumns)) {
      violations.push(`${table} ${role}: permessi per colonna ${JSON.stringify(actual.onColumns)}`);
    }
  };
  const without = (table: string, role: (typeof ROLES)[number], privileges: string[]) => {
    const forbidden = grantsOf(allowlist, table, role).any.filter((privilege) => privileges.includes(privilege));
    if (forbidden.length > 0) violations.push(`${table} ${role}: ha ${forbidden.join(', ')}`);
  };

  for (const table of Object.keys(allowlist)) {
    // app_jobs non ha permessi sulle tabelle di public (00 §6).
    without(table, 'app_jobs', [
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
      'MAINTAIN',
    ]);
  }
  for (const table of [
    'platform_admins',
    'admin_enrollment_tokens',
    'platform_config',
    'stripe_events',
    'issued_invoices_archive',
  ]) {
    if (!has(table)) continue;
    exactly(table, 'app_user', []);
    exactly(table, 'app_worker', []);
  }
  for (const table of ['shop_modules', 'subscriptions']) {
    if (!has(table)) continue;
    exactly(table, 'app_user', ['SELECT']);
    exactly(table, 'app_worker', ['SELECT']);
  }
  if (has('audit_log')) {
    exactly('audit_log', 'app_user', ['SELECT', 'INSERT']);
    exactly('audit_log', 'app_worker', ['SELECT', 'INSERT']);
  }
  if (has('shops')) {
    without('shops', 'app_user', ['INSERT', 'DELETE']);
    without('shops', 'app_worker', ['INSERT', 'DELETE']);
  }
  if (has('sdi_invoices')) {
    without('sdi_invoices', 'app_user', WRITES);
    for (const role of ROLES) without('sdi_invoices', role, ['DELETE']);
  }
  if (has('shop_secrets')) without('shop_secrets', 'app_worker', WRITES);
  if (has('email_suppressions')) {
    exactly('email_suppressions', 'app_user', ['INSERT']);
    exactly('email_suppressions', 'app_worker', ['SELECT']);
  }
  if (has('terms_acceptances')) {
    exactly('terms_acceptances', 'app_user', ['SELECT'], {
      INSERT: ['clauses', 'ip', 'shop_id', 'user_id', 'version'],
    });
    exactly('terms_acceptances', 'app_worker', ['SELECT']);
  }
  for (const table of ['memberships', 'invitations']) {
    if (!has(table)) continue;
    exactly(table, 'app_user', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    exactly(table, 'app_worker', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
  }
  return violations;
}

describe('elenco consentito', () => {
  it('NEG-012: l’elenco nasce con tutte le tabelle esistenti a NEG-T05 (shops, platform_config, audit_log, email_suppressions)', () => {
    expect(Object.keys(TABLE_PRIVILEGES)).toEqual(
      expect.arrayContaining(['shops', 'platform_config', 'audit_log', 'email_suppressions']),
    );
  });

  it('NEG-012: l’elenco rispetta le regole dell’accettazione di NEG-012 per ogni tabella che contiene', () => {
    expect(allowlistViolations(TABLE_PRIVILEGES)).toEqual([]);
  });

  it('NEG-012: shops dà SELECT ai due ruoli e UPDATE delle sole colonne dei dati ad app_user', () => {
    const DATA_COLUMNS = ['address', 'legal_name', 'name', 'pec', 'sdi_code', 'tax_code', 'vat_number'];
    expect(grantsOf(TABLE_PRIVILEGES, 'shops', 'app_user')).toMatchObject({
      onTable: ['SELECT'],
      onColumns: { UPDATE: DATA_COLUMNS },
    });
    expect(grantsOf(TABLE_PRIVILEGES, 'shops', 'app_worker')).toMatchObject({ onTable: ['SELECT'], onColumns: {} });
  });

  it('NEG-012: le regole segnalano un elenco che concede ciò che la specifica vieta', () => {
    const tampered: Allowlist = {
      ...TABLE_PRIVILEGES,
      audit_log: { app_user: { table: ['SELECT', 'INSERT', 'DELETE'] }, app_worker: { table: ['SELECT', 'INSERT'] } },
      shops: { app_user: { table: ['SELECT'], columns: { INSERT: ['name'] } }, app_worker: { table: ['SELECT'] } },
      platform_config: { app_jobs: { table: ['SELECT'] } },
    };
    expect(allowlistViolations(tampered)).toEqual(
      expect.arrayContaining([
        'audit_log app_user: permessi sulla tabella DELETE, INSERT, SELECT',
        'shops app_user: ha INSERT',
        'platform_config app_jobs: ha SELECT',
      ]),
    );
  });

  it('NEG-012: sugli schemi public dà USAGE ad app_user e app_worker e niente ad app_jobs; pgboss non dà nulla ad app_user e app_worker', () => {
    const sorted = (list: readonly string[] | undefined) => [...(list ?? [])].sort();
    expect(sorted(SCHEMA_PRIVILEGES.public?.app_user)).toEqual(['USAGE']);
    expect(sorted(SCHEMA_PRIVILEGES.public?.app_worker)).toEqual(['USAGE']);
    expect(sorted(SCHEMA_PRIVILEGES.public?.app_jobs)).toEqual([]);
    expect(SCHEMA_PRIVILEGES).toHaveProperty('pgboss');
    expect(sorted(SCHEMA_PRIVILEGES.pgboss?.app_user)).toEqual([]);
    expect(sorted(SCHEMA_PRIVILEGES.pgboss?.app_worker)).toEqual([]);
  });
});
