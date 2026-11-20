import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkerBoss } from '@/server/jobs/boss';
import { closeRolePools, rolePool, testDatabaseUrl } from '../../fixtures/db';

// FON-003: pg-boss si avvia come app_jobs su un database appena inizializzato creando il suo schema. Gira sul database
// usa e getta app_fresh, creato ed eliminato qui con le credenziali del proprietario (app_owner ha CREATEDB solo con
// ROLES_ALLOW_CREATEDB=1, in sviluppo e in CI), con CONNECT e CREATE concessi ad app_jobs; non sul database di test
// condiviso, dove lo schema pgboss può esistere già.

const FRESH = 'app_fresh';

let boss: PgBoss | undefined;

async function dropFresh() {
  await rolePool('owner').query(`DROP DATABASE IF EXISTS ${FRESH} WITH (FORCE)`);
}

beforeAll(async () => {
  await dropFresh();
  await rolePool('owner').query(`CREATE DATABASE ${FRESH}`);
  await rolePool('owner').query(`GRANT CONNECT, CREATE ON DATABASE ${FRESH} TO app_jobs`);
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closeRolePools();
  await rolePool('owner').query(`DROP DATABASE IF EXISTS ${FRESH} WITH (FORCE)`);
  await closeRolePools();
});

describe('pg-boss su un database nuovo', () => {
  it('FON-003: pg-boss si avvia come app_jobs e crea lo schema pgboss, che appartiene ad app_jobs', async () => {
    const freshOwner = rolePool('owner', FRESH);
    const before = await freshOwner.query("SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss'");
    expect(before.rowCount).toBe(0);

    const freshBoss = createWorkerBoss(testDatabaseUrl('jobs', FRESH));
    boss = freshBoss;
    freshBoss.on('error', () => {});
    await freshBoss.start();

    const who = await freshBoss.getDb().executeSql('SELECT current_user, current_database()');
    expect(who.rows[0]).toEqual({ current_user: 'app_jobs', current_database: FRESH });
    expect(await freshBoss.schemaVersion()).not.toBeNull();

    const after = await freshOwner.query<{ owner: string; tables: string }>(
      `SELECT n.nspowner::regrole::text AS owner,
              (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind IN ('r', 'p'))::text AS tables
         FROM pg_namespace n WHERE n.nspname = 'pgboss'`,
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]?.owner).toBe('app_jobs');
    expect(Number(after.rows[0]?.tables)).toBeGreaterThan(0);
  });
});
