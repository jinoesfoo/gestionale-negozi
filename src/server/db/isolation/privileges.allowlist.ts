// Elenco consentito dei permessi dei ruoli di runtime (02 NEG-012 e NEG-T05, note (3)–(5) del piano; 00 R-DATI-4).
// Il test dei permessi (tests/integration/app/privileges.test.ts) e isolation-check (BIL-T09) confrontano con questo
// elenco i permessi effettivi letti dal catalogo: per ogni tabella dello schema public che esiste il confronto è esatto,
// sulla tabella e per colonna, per ciascuno dei tre ruoli; una tabella esistente senza voce fa fallire, una voce per una
// tabella non ancora creata è ammessa. Un ruolo assente dalla voce non ha permessi. Ogni compito che crea una tabella, o
// ne cambia i permessi con una migrazione, aggiorna la sua voce; tests/unit/server/db/isolation/allowlist.test.ts
// controlla che l'elenco non conceda ciò che NEG-012 vieta.

/** I ruoli di runtime (00 §6): il proprietario delle tabelle non compare, perché ha comunque ogni permesso. */
export type RuntimeRole = 'app_user' | 'app_worker' | 'app_jobs';

/** I permessi su una tabella (PostgreSQL 18). */
export type TablePrivilege =
  'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE' | 'REFERENCES' | 'TRIGGER' | 'MAINTAIN';

/** I permessi che si concedono su una singola colonna. */
export type ColumnPrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'REFERENCES';

/** I permessi su uno schema. */
export type SchemaPrivilege = 'USAGE' | 'CREATE';

/** I permessi di un ruolo su una tabella: quelli sulla tabella intera e quelli per colonna (permesso → colonne). */
export interface RoleGrants {
  readonly table?: readonly TablePrivilege[];
  readonly columns?: Readonly<Partial<Record<ColumnPrivilege, readonly string[]>>>;
}

/** La voce di una tabella: i permessi per ruolo. */
export type TableAllowlist = Readonly<Partial<Record<RuntimeRole, RoleGrants>>>;

/** Le tabelle dello schema public, per nome senza schema. */
export const TABLE_PRIVILEGES: Readonly<Record<string, TableAllowlist>> = {
  // Migrazione 0005: l'elenco dei negozi si legge; app_user modifica solo i dati del negozio, il resto passa dalle
  // funzioni di piattaforma (02 §Permessi su shops).
  shops: {
    app_user: {
      table: ['SELECT'],
      columns: { UPDATE: ['name', 'legal_name', 'vat_number', 'tax_code', 'sdi_code', 'pec', 'address'] },
    },
    app_worker: { table: ['SELECT'] },
  },
  // Migrazione 0005: si legge solo con platform_config_get().
  platform_config: {},
  // Migrazione 0003: il registro si legge e si scrive, non si modifica né si cancella.
  audit_log: {
    app_user: { table: ['SELECT', 'INSERT'] },
    app_worker: { table: ['SELECT', 'INSERT'] },
  },
  // Migrazione 0003: l'applicazione aggiunge gli indirizzi da non contattare, il worker li legge.
  email_suppressions: {
    app_user: { table: ['INSERT'] },
    app_worker: { table: ['SELECT'] },
  },
  // Migrazione 0008 (02 §Segreti per negozio, NEG-T09): app_user legge, inserisce e cancella i segreti e aggiorna solo
  // il testo cifrato e la data della rotazione; app_worker li legge soltanto.
  shop_secrets: {
    app_user: { table: ['SELECT', 'INSERT', 'DELETE'], columns: { UPDATE: ['ciphertext', 'rotated_at'] } },
    app_worker: { table: ['SELECT'] },
  },
};

/** Gli schemi controllati: public dà solo USAGE ai due ruoli; pgboss (di app_jobs) non dà nulla ai ruoli di public. */
export const SCHEMA_PRIVILEGES: Readonly<
  Record<string, Readonly<Partial<Record<RuntimeRole, readonly SchemaPrivilege[]>>>>
> = {
  public: { app_user: ['USAGE'], app_worker: ['USAGE'] },
  pgboss: {},
};
