import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createWorkerBoss } from '@/server/jobs/boss';
import { QUEUES, ensureQueues } from '@/server/jobs/queues';
import { startWorker } from '@/worker';
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

// FON-T10: le prove sull'avvio del worker e su ensureQueues() che hanno bisogno di un database dove le code non
// esistono ancora, o dove una coda si può ricreare con un'altra politica. Stanno in questo file, sullo stesso app_fresh
// (nota della revisione di FON-T03: i file di integrazione girano in parallelo, e un altro file che chiudesse le
// connessioni di app_fresh farebbe fallire questo a caso). Le prove del file girano in ordine: qui sotto il pg-boss di
// app_fresh è già avviato dalla prova precedente.
//
// pg-boss crea da sé, all'avvio con la pianificazione attiva, le sue code interne (in 12.38.2 `__pgboss__send-it`, del
// pianificatore, timekeeper.js): non fanno parte dell'elenco di 05, e le prove le lasciano fuori dai confronti (nota
// (14) della fase codice di FON-T10).

const isInternalQueue = (name: string) => name.startsWith('__pgboss__');

/** I nomi delle code del progetto (senza quelle interne di pg-boss), in ordine. */
async function projectQueueNames(fresh: PgBoss): Promise<string[]> {
  return (await fresh.getQueues())
    .map((queue) => queue.name)
    .filter((name) => !isInternalQueue(name))
    .sort();
}

class ExitCalled extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

function freshBoss(): PgBoss {
  if (boss === undefined) throw new Error('il pg-boss di app_fresh non è avviato: va eseguita la prova precedente');
  return boss;
}

describe('code dei lavori su un database nuovo', () => {
  it('FON-003: ensureQueues crea su app_fresh tutte le code di 05, ciascuna con la politica dichiarata', async () => {
    const fresh = freshBoss();
    // Prima: nessuna delle code dell'elenco (pg-boss può avere già le sue interne).
    expect(await projectQueueNames(fresh)).toEqual([]);
    await ensureQueues(fresh);
    const queues = await fresh.getQueues();
    expect(await projectQueueNames(fresh)).toEqual(QUEUES.map((queue) => queue.name).sort());
    for (const queue of QUEUES) {
      expect(queues.find((stored) => stored.name === queue.name)?.policy, queue.name).toBe(queue.policy);
    }
  });

  it('BIL-006: billing.sync è creata singleton', async () => {
    expect((await freshBoss().getQueue('billing.sync'))?.policy).toBe('singleton');
  });

  it('BIL-016: invoicing.sdi è creata singleton, con 5 tentativi e attesa crescente', async () => {
    expect(await freshBoss().getQueue('invoicing.sdi')).toMatchObject({
      policy: 'singleton',
      retryLimit: 5,
      retryBackoff: true,
    });
  });

  it('FON-003: ensureQueues ripetuta sulle code già create non cambia nulla e non si ferma', async () => {
    const fresh = freshBoss();
    const before = await fresh.getQueues();
    await expect(ensureQueues(fresh)).resolves.toBeUndefined();
    const after = await fresh.getQueues();
    expect(
      after.map(({ name, policy, retryLimit, retryBackoff }) => ({ name, policy, retryLimit, retryBackoff })),
    ).toEqual(before.map(({ name, policy, retryLimit, retryBackoff }) => ({ name, policy, retryLimit, retryBackoff })));
  });

  it('BIL-006: con una coda billing.sync esistente creata standard il worker non parte, e nomina la coda', async () => {
    const fresh = freshBoss();
    await fresh.deleteQueue('billing.sync');
    await fresh.createQueue('billing.sync', { policy: 'standard' });
    expect((await fresh.getQueue('billing.sync'))?.policy).toBe('standard');

    const output: string[] = [];
    const capture = (...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    };
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitCalled(code);
    });
    try {
      // L'ambiente del worker di .env.test, con la coda su app_fresh e il database come app_worker.
      const env = {
        ...process.env,
        DATABASE_URL: testDatabaseUrl('worker'),
        DATABASE_JOBS_URL: testDatabaseUrl('jobs', FRESH),
      };
      let exit: ExitCalled | undefined;
      try {
        await startWorker(env);
      } catch (error) {
        if (!(error instanceof ExitCalled)) throw error;
        exit = error;
      }
      expect(exit?.code).toBe(1);
      expect(output.join('\n')).toContain('billing.sync');
      // La coda è rimasta com'era: il worker non la cambia da sé (la correzione si fa a mano).
      expect((await fresh.getQueue('billing.sync'))?.policy).toBe('standard');
    } finally {
      vi.restoreAllMocks();
    }
  });
});
