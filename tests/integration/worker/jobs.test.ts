import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { isEmailSuppressed } from '@/server/db/email-suppressions';
import { enqueueEmail } from '@/server/email/enqueue';
import { FakeEmailSender } from '@/server/email/fake';
import { createWorkerBoss } from '@/server/jobs/boss';
import { sendEmailJob } from '@/server/jobs/email-send';
import { registerJobs } from '@/server/jobs/registry';
import { closeRolePools, rolePool, testDatabaseUrl } from '../../fixtures/db';

// Il worker con la coda e il database veri (01 FON-T10): pg-boss come app_jobs esegue un lavoro di prova; `email.send`
// con il fornitore finto registra il messaggio; verso un indirizzo escluso (letto da email_suppressions con il ruolo
// del worker, app_worker: DATABASE_URL = TEST_DATABASE_WORKER_URL) termina senza invio e con esito `suppressed`. Le
// code esistono già: le crea il globalSetup dei test di integrazione con ensureQueues(). La coda di prova la crea e la
// toglie questo file; le righe e i lavori di questo file si tolgono alla fine.

const DOMAIN = 'fon-t10-worker.example.com';
const TEST_QUEUE = `test.fon-t10.${randomUUID()}`;
const address = (tag: string) => `${tag}-${randomUUID()}@${DOMAIN}`;

let boss: PgBoss;

/** Aspetta che il lavoro arrivi a uno stato finale; restituisce il lavoro. */
async function settled(name: string, id: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await boss.getJobById(name, id);
    if (job && ['completed', 'failed', 'cancelled'].includes(job.state)) return job;
    if (Date.now() > deadline) throw new Error(`il lavoro ${name} non è finito in ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

beforeAll(async () => {
  boss = createWorkerBoss(testDatabaseUrl('jobs'));
  boss.on('error', () => {});
  await boss.start();
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await rolePool('owner').query('DELETE FROM public.email_suppressions WHERE email LIKE $1', [`%@${DOMAIN}`]);
  await rolePool('jobs').query("DELETE FROM pgboss.job WHERE name = 'email.send' AND data->>'to' LIKE $1", [
    `%@${DOMAIN}`,
  ]);
  await closeDb();
  await closeRolePools();
});

describe('lavori del worker', () => {
  it('FON-003: pg-boss, come app_jobs, esegue un lavoro di prova', async () => {
    const who = await boss.getDb().executeSql('SELECT current_user');
    expect(who.rows[0]).toEqual({ current_user: 'app_jobs' });

    await boss.createQueue(TEST_QUEUE);
    try {
      const received: unknown[] = [];
      await boss.work<{ ping: number }>(TEST_QUEUE, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
        for (const job of jobs) received.push(job.data);
        return { pong: true };
      });
      const id = await boss.send(TEST_QUEUE, { ping: 1 });
      expect(id).toBeTruthy();
      const job = await settled(TEST_QUEUE, id!);
      expect(job.state).toBe('completed');
      expect(received).toEqual([{ ping: 1 }]);
    } finally {
      await boss.offWork(TEST_QUEUE);
      await boss.deleteQueue(TEST_QUEUE);
    }
  });

  it('FON-011: email.send verso un indirizzo escluso termina senza invio e con esito suppressed', async () => {
    const email = address('escluso');
    await rolePool('owner').query("INSERT INTO public.email_suppressions (email, reason) VALUES ($1, 'bounce')", [
      email,
    ]);
    const sender = new FakeEmailSender();
    expect(await isEmailSuppressed(email)).toBe(true);
    expect(await isEmailSuppressed(address('non-escluso'))).toBe(false);

    const result = await sendEmailJob(
      { to: email.toUpperCase(), template: 'prova', data: {} },
      { sender, isSuppressed: isEmailSuppressed },
    );
    expect(result).toEqual({ status: 'suppressed' });
    expect(sender.sent).toEqual([]);
  });

  it('FON-011: email.send, passando dalla coda, invia con il fornitore finto e apre il link cifrato', async () => {
    const sender = new FakeEmailSender();
    await registerJobs(boss, { sender, isSuppressed: isEmailSuppressed });
    try {
      const to = address('destinatario');
      const link = `https://app.localhost/invito/${randomUUID()}`;
      const id = await enqueueEmail(boss, { to, template: 'prova', data: {}, secrets: { link } });
      expect(id).toBeTruthy();
      const job = await settled('email.send', id!);
      expect(job.state).toBe('completed');
      expect(job.output).toMatchObject({ status: 'sent' });
      const message = sender.sent.find((sent) => sent.to === to);
      expect(message?.text).toContain(link);
    } finally {
      await boss.offWork('email.send');
    }
  });

  // Dalla revisione di FON-T10: l'esito `suppressed` si prova anche passando dalla coda, come lo salva pg-boss.
  it('FON-011: email.send verso un indirizzo escluso, passando dalla coda, termina con esito suppressed senza invio', async () => {
    const email = address('escluso-coda');
    await rolePool('owner').query("INSERT INTO public.email_suppressions (email, reason) VALUES ($1, 'complaint')", [
      email,
    ]);
    const sender = new FakeEmailSender();
    await registerJobs(boss, { sender, isSuppressed: isEmailSuppressed });
    try {
      const id = await enqueueEmail(boss, { to: email.toUpperCase(), template: 'prova', data: {} });
      expect(id).toBeTruthy();
      const job = await settled('email.send', id!);
      expect(job.state).toBe('completed');
      expect(job.output).toEqual({ status: 'suppressed' });
      expect(sender.sent.filter((sent) => sent.to.toLowerCase() === email)).toEqual([]);
    } finally {
      await boss.offWork('email.send');
    }
  });
});
