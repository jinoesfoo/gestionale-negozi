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
// valgono appena la tabella entra nell'elenco. Nota (12)(a): su ogni tabella, app_user e app_worker hanno solo SELECT,
// INSERT, UPDATE e DELETE. NEG-T09, nota (3): shop_secrets ha regole esatte, come shops.

type Allowlist = Readonly<Record<string, TableAllowlist>>;
const ROLES = ['app_user', 'app_worker', 'app_jobs'] as const;
const WRITES = ['INSERT', 'UPDATE', 'DELETE'];
/** I permessi che non riguardano i dati: nessun ruolo di runtime li ha (nota (12)(a)). */
const NON_DATA_PRIVILEGES = ['TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'];
/** Le colonne dei dati del negozio, le sole che app_user modifica (02 §Permessi su shops, NEG-009), in ordine. */
const SHOPS_DATA_COLUMNS = ['address', 'legal_name', 'name', 'pec', 'sdi_code', 'tax_code', 'vat_number'];
/** Le sole colonne di shop_secrets che app_user aggiorna (02 §Segreti per negozio, NEG-T09 nota (3)), in ordine. */
const SHOP_SECRETS_UPDATE_COLUMNS = ['ciphertext', 'rotated_at'];

type ColumnGrants = Readonly<Partial<Record<string, readonly string[]>>>;

/**
 * I permessi per colonna in ordine, sia i nomi dei permessi sia le colonne, senza i permessi con l'elenco vuoto: così
 * il confronto con JSON.stringify non dipende dall'ordine in cui sono scritti (nota (13)(a)).
 */
function sortedColumns(columns: ColumnGrants): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([, list]) => (list ?? []).length > 0)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([privilege, list]) => [privilege, [...(list ?? [])].sort()]),
  );
}

/** I permessi di un ruolo su una tabella: quelli sulla tabella e quelli per colonna, come elenchi ordinati. */
function grantsOf(allowlist: Allowlist, table: string, role: (typeof ROLES)[number]) {
  const grants: RoleGrants | undefined = allowlist[table]?.[role];
  const onTable = [...(grants?.table ?? [])].sort();
  const onColumns = sortedColumns(grants?.columns ?? {});
  /** Ogni permesso, sulla tabella o su almeno una colonna. */
  const any = [...new Set([...onTable, ...Object.keys(onColumns)])].sort();
  return { onTable, onColumns, any };
}

/** Le violazioni delle regole di NEG-012 nell'elenco dato. */
function allowlistViolations(allowlist: Allowlist): string[] {
  const violations: string[] = [];
  const has = (table: string) => Object.hasOwn(allowlist, table);
  const exactly = (table: string, role: (typeof ROLES)[number], onTable: string[], onColumns: ColumnGrants = {}) => {
    const actual = grantsOf(allowlist, table, role);
    if (JSON.stringify(actual.onTable) !== JSON.stringify([...onTable].sort())) {
      violations.push(`${table} ${role}: permessi sulla tabella ${actual.onTable.join(', ')}`);
    }
    if (JSON.stringify(actual.onColumns) !== JSON.stringify(sortedColumns(onColumns))) {
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
    // Nota (12)(a): agli altri ruoli di runtime solo permessi sui dati. TRUNCATE non passa dalla RLS, TRIGGER aggancia
    // una funzione alle scritture di ogni negozio, MAINTAIN comprende LOCK TABLE; REFERENCES non serve a nessuna area.
    for (const role of ['app_user', 'app_worker'] as const) {
      without(table, role, NON_DATA_PRIVILEGES);
    }
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
    // Nota (11)(b): regole esatte di §Permessi su shops.
    exactly('shops', 'app_user', ['SELECT'], { UPDATE: SHOPS_DATA_COLUMNS });
    exactly('shops', 'app_worker', ['SELECT']);
  }
  if (has('sdi_invoices')) {
    without('sdi_invoices', 'app_user', WRITES);
    for (const role of ROLES) without('sdi_invoices', role, ['DELETE']);
  }
  if (has('shop_secrets')) {
    without('shop_secrets', 'app_worker', WRITES);
    // NEG-T09, nota (3): regole esatte di §Segreti per negozio.
    exactly('shop_secrets', 'app_user', ['SELECT', 'INSERT', 'DELETE'], { UPDATE: SHOP_SECRETS_UPDATE_COLUMNS });
    exactly('shop_secrets', 'app_worker', ['SELECT']);
  }
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

  it('NEG-012: shops dà SELECT ai due ruoli e UPDATE delle sole colonne dei dati ad app_user, e nient’altro', () => {
    const exact = (role: (typeof ROLES)[number]) => {
      const { onTable, onColumns } = grantsOf(TABLE_PRIVILEGES, 'shops', role);
      return { onTable, onColumns };
    };
    expect(exact('app_user')).toEqual({ onTable: ['SELECT'], onColumns: { UPDATE: SHOPS_DATA_COLUMNS } });
    expect(exact('app_worker')).toEqual({ onTable: ['SELECT'], onColumns: {} });
    expect(exact('app_jobs')).toEqual({ onTable: [], onColumns: {} });
  });

  it('NEG-012: shop_secrets dà ad app_user SELECT, INSERT, DELETE e UPDATE di ciphertext e rotated_at, ad app_worker solo SELECT, e nient’altro (NEG-T09)', () => {
    expect(TABLE_PRIVILEGES).toHaveProperty('shop_secrets');
    const exact = (role: (typeof ROLES)[number]) => {
      const { onTable, onColumns } = grantsOf(TABLE_PRIVILEGES, 'shop_secrets', role);
      return { onTable, onColumns };
    };
    expect(exact('app_user')).toEqual({
      onTable: ['DELETE', 'INSERT', 'SELECT'],
      onColumns: { UPDATE: SHOP_SECRETS_UPDATE_COLUMNS },
    });
    expect(exact('app_worker')).toEqual({ onTable: ['SELECT'], onColumns: {} });
    expect(exact('app_jobs')).toEqual({ onTable: [], onColumns: {} });
  });

  it('NEG-012: i permessi per colonna si confrontano senza dipendere dall’ordine dei permessi e delle colonne', () => {
    // Nota (13)(a): due permessi per colonna scritti in ordine diverso danno lo stesso confronto.
    const onColumns = (columns: RoleGrants['columns']) =>
      JSON.stringify(grantsOf({ t: { app_user: { columns } } }, 't', 'app_user').onColumns);
    expect(onColumns({ UPDATE: ['b', 'a'], SELECT: ['c'] })).toBe(onColumns({ SELECT: ['c'], UPDATE: ['a', 'b'] }));
    expect(onColumns({ UPDATE: ['b', 'a'], SELECT: ['c'] })).toBe('{"SELECT":["c"],"UPDATE":["a","b"]}');
  });

  it('NEG-012: le regole segnalano un elenco che concede ciò che la specifica vieta', () => {
    const tampered: Allowlist = {
      ...TABLE_PRIVILEGES,
      audit_log: { app_user: { table: ['SELECT', 'INSERT', 'DELETE'] }, app_worker: { table: ['SELECT', 'INSERT'] } },
      shops: {
        app_user: { table: ['SELECT'], columns: { INSERT: ['name'] } },
        app_worker: { table: ['SELECT'], columns: { UPDATE: ['status'] } },
      },
      platform_config: { app_jobs: { table: ['SELECT'] } },
      // Nota (12)(a): una tabella senza regola esatta, con permessi che non riguardano i dati.
      sdi_invoices: {
        app_user: { table: ['SELECT', 'TRUNCATE'] },
        app_worker: { table: ['SELECT'], columns: { REFERENCES: ['shop_id'] } },
      },
      // NEG-T09, nota (3): UPDATE su ogni colonna per app_user e una cancellazione per app_worker.
      shop_secrets: {
        app_user: { table: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
        app_worker: { table: ['SELECT', 'DELETE'] },
      },
    };
    expect(allowlistViolations(tampered)).toEqual(
      expect.arrayContaining([
        'audit_log app_user: permessi sulla tabella DELETE, INSERT, SELECT',
        'shops app_user: ha INSERT',
        'shops app_user: permessi per colonna {"INSERT":["name"]}',
        'shops app_worker: permessi per colonna {"UPDATE":["status"]}',
        'platform_config app_jobs: ha SELECT',
        'sdi_invoices app_user: ha TRUNCATE',
        'sdi_invoices app_worker: ha REFERENCES',
        'shop_secrets app_user: permessi sulla tabella DELETE, INSERT, SELECT, UPDATE',
        'shop_secrets app_user: permessi per colonna {}',
        'shop_secrets app_worker: ha DELETE',
        'shop_secrets app_worker: permessi sulla tabella DELETE, SELECT',
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
