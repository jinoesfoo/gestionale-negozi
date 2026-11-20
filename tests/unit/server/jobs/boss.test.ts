import { describe, expect, it } from 'vitest';
import { appBossOptions, workerBossOptions } from '@/server/jobs/boss';

// FON-003 e 01 §Client del database: app e worker usano la coda come app_jobs (DATABASE_JOBS_URL), nello schema
// pgboss. Nell'app l'istanza serve solo ad accodare: niente manutenzione né pianificazione, che fa solo il worker
// (altrimenti due processi si contenderebbero i lavori pianificati).

const url = 'postgres://app_jobs:valore-di-prova@127.0.0.1:5432/app';

describe('opzioni di pg-boss', () => {
  it('FON-003: l’istanza dell’app usa lo schema pgboss senza manutenzione né pianificazione', () => {
    expect(appBossOptions(url)).toMatchObject({
      connectionString: url,
      schema: 'pgboss',
      supervise: false,
      schedule: false,
    });
  });

  it('FON-003: l’istanza del worker usa lo schema pgboss e fa manutenzione e pianificazione', () => {
    const options = workerBossOptions(url);
    expect(options).toMatchObject({ connectionString: url, schema: 'pgboss' });
    expect(options.supervise ?? true).toBe(true);
    expect(options.schedule ?? true).toBe(true);
  });
});
