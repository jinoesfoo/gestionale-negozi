import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { enqueueEmail } from '@/server/email/enqueue';
import { getAppBoss, stopAppBoss } from '@/server/jobs/app-boss';
import { openJobSecret } from '@/server/jobs/seal';
import { closeRolePools, rolePool } from '../../fixtures/db';

// 00 §4.3 con la coda vera (01 FON-T10): un link con un token accodato dall'app con `email.send` non compare in chiaro
// in pgboss.job; il campo `secrets` è cifrato con JOB_PAYLOAD_KEY e si riapre con la stessa chiave; il lavoro si
// cancella un'ora dopo il completamento. Accoda con l'istanza pg-boss dell'app (app_jobs) e legge pgboss.job con
// app_jobs, che ne è il proprietario. Il lavoro accodato si toglie alla fine, così nessun worker lo prende dopo.
// Nessun requisito con ID copre 00 §4.3: i test portano `00§4.3` nel nome (nota (2) del piano di FON-T10).

const ids: string[] = [];

afterAll(async () => {
  if (ids.length > 0) await rolePool('jobs').query('DELETE FROM pgboss.job WHERE id = ANY($1::uuid[])', [ids]);
  await stopAppBoss();
  await closeRolePools();
});

describe('segreti nei lavori in coda', () => {
  it('00§4.3: un link d’invito accodato con email.send non compare in chiaro in pgboss.job e si riapre con la chiave', async () => {
    const token = randomBytes(32).toString('hex');
    const link = `https://app.localhost/invito/${token}`;
    const id = await enqueueEmail(await getAppBoss(), {
      to: 'destinatario@fon-t10-segreti.example.com',
      template: 'prova',
      data: {},
      secrets: { link },
    });
    expect(id).toBeTruthy();
    ids.push(id!);

    const jobs = rolePool('jobs');
    const anywhere = await jobs.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pgboss.job
        WHERE data::text LIKE '%' || $1 || '%' OR coalesce(output::text, '') LIKE '%' || $1 || '%'`,
      [token],
    );
    expect(anywhere.rows[0]?.n).toBe(0);

    const stored = await jobs.query<{ name: string; secrets: string }>(
      "SELECT name, data->>'secrets' AS secrets FROM pgboss.job WHERE id = $1",
      [id],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.name).toBe('email.send');
    expect(stored.rows[0]?.secrets).not.toContain(token);
    expect(JSON.parse(openJobSecret(stored.rows[0]!.secrets))).toEqual({ link });
  });

  it('00§4.3: il lavoro email.send si cancella un’ora dopo il completamento (deleteAfterSeconds = 3600)', async () => {
    const boss = await getAppBoss();
    const id = await enqueueEmail(boss, {
      to: 'destinatario@fon-t10-segreti.example.com',
      template: 'prova',
      data: {},
    });
    expect(id).toBeTruthy();
    ids.push(id!);
    const job = await boss.getJobById('email.send', id!);
    expect(job?.deleteAfterSeconds).toBe(3600);
  });
});
