import type { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getPool } from '@/server/db/client';
import { createAppBoss } from '@/server/jobs/boss';
import { closeRolePools, rolePool } from '../../fixtures/db';

// FON-003: ruoli del database (00 §6, 01 §Inizializzazione del database). Il catalogo si legge con il ruolo
// proprietario dei test; le connessioni dell'app sono quelle vere del codice: il client dei dati (DATABASE_URL,
// app_user) e l'istanza pg-boss dell'app (DATABASE_JOBS_URL, app_jobs). La parte di pg-boss su un database appena
// creato è in pgboss-fresh.test.ts.

const owner = () => rolePool('owner');
const RUNTIME_ROLES = ['app_user', 'app_worker', 'app_jobs'];
const ALL_ROLES = ['app_owner', ...RUNTIME_ROLES];

let boss: PgBoss | undefined;

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closeDb();
  await closeRolePools();
});

describe('ruoli del database', () => {
  it('FON-003: esistono i quattro ruoli di login', async () => {
    const { rows } = await owner().query<{ rolname: string; rolcanlogin: boolean }>(
      'SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname',
      [ALL_ROLES],
    );
    expect(rows).toEqual([...ALL_ROLES].sort().map((rolname) => ({ rolname, rolcanlogin: true })));
  });

  it('FON-003: lo schema public del database app appartiene ad app_owner', async () => {
    const { rows } = await owner().query<{ db: string; owner: string }>(
      "SELECT current_database() AS db, nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'public'",
    );
    expect(rows).toEqual([{ db: 'app', owner: 'app_owner' }]);
  });

  it('FON-003: app_user, app_worker e app_jobs non hanno BYPASSRLS', async () => {
    const { rows } = await owner().query<{ rolname: string; rolbypassrls: boolean }>(
      'SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname',
      [RUNTIME_ROLES],
    );
    expect(rows).toEqual([...RUNTIME_ROLES].sort().map((rolname) => ({ rolname, rolbypassrls: false })));
  });

  it('FON-003: app_user e app_jobs non possiedono tabelle né altri oggetti dello schema public', async () => {
    const { rows } = await owner().query<{ kind: string; name: string; owner: string }>(
      `SELECT 'relazione' AS kind, c.relname AS name, c.relowner::regrole::text AS owner
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
       UNION ALL
       SELECT 'funzione', p.proname, p.proowner::regrole::text
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       UNION ALL
       SELECT 'tipo', t.typname, t.typowner::regrole::text
         FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace`,
    );
    expect(rows.filter((row) => row.owner === 'app_user' || row.owner === 'app_jobs')).toEqual([]);
  });

  it('FON-003: app_jobs non ha permessi sullo schema public né sui suoi oggetti', async () => {
    const schema = await owner().query<{ usage: boolean; create: boolean }>(
      `SELECT has_schema_privilege('app_jobs', 'public', 'USAGE') AS usage,
              has_schema_privilege('app_jobs', 'public', 'CREATE') AS create`,
    );
    expect(schema.rows).toEqual([{ usage: false, create: false }]);

    const objects = await owner().query<{ kind: string; name: string }>(
      `SELECT 'relazione' AS kind, c.relname AS name
         FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege('app_jobs', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       UNION ALL
       SELECT 'sequenza', c.relname
         FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
          -- SQL non garantisce l'ordine delle condizioni del WHERE: senza CASE PostgreSQL può chiamare
          -- has_sequence_privilege anche su relazioni che non sono sequenze (le tabelle TOAST), e fallire.
          AND CASE WHEN c.relkind = 'S'
                   THEN has_sequence_privilege('app_jobs', c.oid, 'USAGE, SELECT, UPDATE')
                   ELSE false END
       UNION ALL
       SELECT 'funzione', p.proname
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('app_jobs', p.oid, 'EXECUTE')`,
    );
    expect(objects.rows).toEqual([]);
  });

  it('FON-003: ogni ruolo ha il search_path fisso', async () => {
    const { rows } = await owner().query<{ rolname: string; rolconfig: string[] | null }>(
      'SELECT rolname, rolconfig FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname',
      [ALL_ROLES],
    );
    const searchPath = Object.fromEntries(
      rows.map((row) => [row.rolname, (row.rolconfig ?? []).filter((setting) => setting.startsWith('search_path='))]),
    );
    expect(searchPath).toEqual({
      app_owner: ['search_path=public'],
      app_user: ['search_path=public'],
      app_worker: ['search_path=public'],
      app_jobs: ['search_path=pgboss'],
    });
  });

  it('FON-003: in sviluppo e nei test app_owner ha CREATEDB (ROLES_ALLOW_CREATEDB=1), gli altri ruoli no', async () => {
    const { rows } = await owner().query<{ rolname: string; rolcreatedb: boolean }>(
      'SELECT rolname, rolcreatedb FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname',
      [ALL_ROLES],
    );
    expect(Object.fromEntries(rows.map((row) => [row.rolname, row.rolcreatedb]))).toEqual({
      app_owner: true,
      app_user: false,
      app_worker: false,
      app_jobs: false,
    });
  });

  it('FON-003: gli unici schemi non di sistema sono public, drizzle e pgboss', async () => {
    const { rows } = await owner().query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
        ORDER BY nspname`,
    );
    const schemas = rows.map((row) => row.nspname);
    expect(schemas.filter((name) => !['public', 'drizzle', 'pgboss'].includes(name))).toEqual([]);
    expect(schemas).toEqual(expect.arrayContaining(['public', 'drizzle']));
  });

  it('FON-003: l’app si collega come app_user per i dati e come app_jobs per la coda', async () => {
    const data = await getPool().query<{ current_user: string }>('SELECT current_user');
    expect(data.rows[0]?.current_user).toBe('app_user');

    const appBoss = createAppBoss();
    boss = appBoss;
    appBoss.on('error', () => {});
    await appBoss.start();
    const queue = await appBoss.getDb().executeSql('SELECT current_user');
    expect(queue.rows[0]?.current_user).toBe('app_jobs');
  });
});
