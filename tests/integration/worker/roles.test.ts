import type { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getPool } from '@/server/db/client';
import { createWorkerBoss } from '@/server/jobs/boss';

// FON-003: il worker si collega come app_worker per i dati (DATABASE_URL = TEST_DATABASE_WORKER_URL nel setup del
// progetto int-worker) e come app_jobs per la coda (DATABASE_JOBS_URL).

let boss: PgBoss | undefined;

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closeDb();
});

describe('connessioni del worker', () => {
  it('FON-003: il worker si collega come app_worker per i dati e come app_jobs per la coda', async () => {
    const data = await getPool().query<{ current_user: string }>('SELECT current_user');
    expect(data.rows[0]?.current_user).toBe('app_worker');

    const workerBoss = createWorkerBoss();
    boss = workerBoss;
    workerBoss.on('error', () => {});
    await workerBoss.start();
    const queue = await workerBoss.getDb().executeSql('SELECT current_user');
    expect(queue.rows[0]?.current_user).toBe('app_jobs');
  });
});
