import { describe, expect, it, vi } from 'vitest';
import { FakeEmailSender } from '@/server/email/fake';
import { QUEUES } from '@/server/jobs/queues';
import { registerJobs } from '@/server/jobs/registry';

// Registro dei lavori (01 FON-T10, specs/README.md): i gestori si registrano in src/server/jobs/ (un file per lavoro e
// un registro), non in src/worker.ts. FON-T10 registra solo `email.send`, senza pianificazioni: ogni compito che
// scrive il gestore di un lavoro periodico ne registra la pianificazione insieme a work() (05 §Lavori periodici).

function fakeBoss() {
  return {
    work: vi.fn<(name: string, ...rest: unknown[]) => Promise<string>>(async () => 'id-del-gestore'),
    schedule: vi.fn(),
  };
}

const deps = { sender: new FakeEmailSender(), isSuppressed: async () => false };

describe('registro dei lavori', () => {
  it('FON-011: registra il gestore di email.send, con un esito per lavoro (perJobResults)', async () => {
    const boss = fakeBoss();
    await registerJobs(boss, deps);
    expect(boss.work.mock.calls.map(([name]) => name)).toEqual(['email.send']);
    expect(boss.work).toHaveBeenCalledWith(
      'email.send',
      expect.objectContaining({ perJobResults: true }),
      expect.any(Function),
    );
  });

  it('FON-003: ogni gestore registrato lavora su una coda dell’elenco di ensureQueues', async () => {
    const boss = fakeBoss();
    await registerJobs(boss, deps);
    const names = new Set(QUEUES.map((queue) => queue.name));
    for (const [name] of boss.work.mock.calls) expect(names.has(name), name).toBe(true);
  });

  it('FON-003: nessuna pianificazione in FON-T10', async () => {
    const boss = fakeBoss();
    await registerJobs(boss, deps);
    expect(boss.schedule).not.toHaveBeenCalled();
  });
});
