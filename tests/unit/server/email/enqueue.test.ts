import { describe, expect, it, vi } from 'vitest';
import { EMAIL_JOB_DELETE_AFTER_SECONDS, enqueueEmail, type EmailJobData } from '@/server/email/enqueue';
import { openJobSecret } from '@/server/jobs/seal';

// Accodamento delle email (01 FON-T10, 00 §4.3): tutte le email partono dal lavoro `email.send` del worker; chi le
// manda le accoda soltanto, dopo il commit della transazione che le provoca. I segreti (per esempio un link con un
// token) viaggiano nel campo `secrets`, cifrato con JOB_PAYLOAD_KEY; il lavoro si cancella un'ora dopo il
// completamento (`deleteAfterSeconds`, verificata in pg-boss 12.38).

const key = Buffer.alloc(32, 9).toString('base64');
const TOKEN = 'VALORE-PROVA-TOKEN-INVITO-0123456789abcdef';
const LINK = `https://app.localhost/invito/${TOKEN}`;

function fakeBoss() {
  return {
    send: vi.fn<(name: string, data: object, options: object) => Promise<string | null>>(async () => 'id-del-lavoro'),
  };
}

describe('accodamento delle email', () => {
  it('00§4.3: accoda email.send con conservazione di un’ora dopo il completamento', async () => {
    const boss = fakeBoss();
    const id = await enqueueEmail(boss, { to: 'avvisi@example.com', template: 'prova', data: {} }, { key });
    expect(id).toBe('id-del-lavoro');
    expect(EMAIL_JOB_DELETE_AFTER_SECONDS).toBe(3600);
    expect(boss.send).toHaveBeenCalledWith(
      'email.send',
      expect.anything(),
      expect.objectContaining({ deleteAfterSeconds: 3600 }),
    );
  });

  it('00§4.3: il link segreto viaggia cifrato: nei dati del lavoro non compare in chiaro', async () => {
    const boss = fakeBoss();
    await enqueueEmail(
      boss,
      { to: 'destinatario@example.com', template: 'prova', data: {}, secrets: { link: LINK } },
      { key },
    );
    const data = boss.send.mock.calls[0]![1] as EmailJobData;
    expect(JSON.stringify(data)).not.toContain(TOKEN);
    expect(data).toMatchObject({ to: 'destinatario@example.com', template: 'prova', data: {} });
    expect(typeof data.secrets).toBe('string');
    expect(JSON.parse(openJobSecret(data.secrets!, key))).toEqual({ link: LINK });
  });

  it('00§4.3: senza segreti il lavoro non ha il campo secrets', async () => {
    const boss = fakeBoss();
    await enqueueEmail(
      boss,
      { to: 'avvisi@example.com', template: 'email-suppressed', data: { email: 'x@example.com', reason: 'bounce' } },
      { key },
    );
    const data = boss.send.mock.calls[0]![1] as EmailJobData;
    expect(data).toEqual({
      to: 'avvisi@example.com',
      template: 'email-suppressed',
      data: { email: 'x@example.com', reason: 'bounce' },
    });
  });
});
