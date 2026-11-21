import { describe, expect, it, vi } from 'vitest';
import type { EmailJobData } from '@/server/email/enqueue';
import { FakeEmailSender } from '@/server/email/fake';
import { createEmailSender } from '@/server/email/provider';
import { createEmailSendHandler, sendEmailJob } from '@/server/jobs/email-send';
import { sealJobSecret } from '@/server/jobs/seal';

// Il lavoro `email.send` (01 FON-T10, FON-011): prima di inviare legge `email_suppressions`; verso un indirizzo escluso
// termina senza invio con esito `suppressed`. Apre i segreti cifrati del lavoro (00 §4.3), compone il messaggio con il
// modello e lo invia con l'EmailSender scelto da EMAIL_PROVIDER.

const key = Buffer.alloc(32, 5).toString('base64');
const LINK = 'https://app.localhost/invito/VALORE-PROVA-TOKEN-0123456789abcdef';

function deps(suppressed: string[] = []) {
  const sender = new FakeEmailSender();
  const isSuppressed = vi.fn(async (email: string) => suppressed.includes(email));
  return { sender, isSuppressed, key };
}

describe('lavoro email.send', () => {
  it('FON-011: verso un indirizzo escluso termina senza invio e con esito suppressed (confronto in minuscolo)', async () => {
    const d = deps(['escluso@example.com']);
    const data: EmailJobData = { to: 'Escluso@Example.com', template: 'prova', data: {} };
    await expect(sendEmailJob(data, d)).resolves.toEqual({ status: 'suppressed' });
    expect(d.isSuppressed).toHaveBeenCalledWith('escluso@example.com');
    expect(d.sender.sent).toEqual([]);
  });

  it('FON-011: verso un indirizzo non escluso compone il messaggio con il modello e lo invia', async () => {
    const d = deps();
    const data: EmailJobData = {
      to: 'avvisi@example.com',
      template: 'email-suppressed',
      data: { email: 'rimbalzo@example.com', reason: 'bounce' },
    };
    const result = await sendEmailJob(data, d);
    expect(result).toMatchObject({ status: 'sent' });
    expect(d.sender.sent).toHaveLength(1);
    const message = d.sender.sent[0]!;
    expect(message.to).toBe('avvisi@example.com');
    expect(message.subject).toContain('rimbalzo@example.com');
    expect(message.text).toContain('rimbalzo definitivo');
    expect(message.html.length).toBeGreaterThan(0);
  });

  it('00§4.3: apre i segreti cifrati del lavoro e li passa al modello', async () => {
    const d = deps();
    const data: EmailJobData = {
      to: 'destinatario@example.com',
      template: 'prova',
      data: {},
      secrets: sealJobSecret(JSON.stringify({ link: LINK }), key),
    };
    await sendEmailJob(data, d);
    expect(d.sender.sent[0]?.text).toContain(LINK);
  });

  it('00§4.3: segreti cifrati con un’altra chiave fanno fallire il lavoro, senza inviare', async () => {
    const d = deps();
    const data: EmailJobData = {
      to: 'destinatario@example.com',
      template: 'prova',
      data: {},
      secrets: sealJobSecret(JSON.stringify({ link: LINK }), Buffer.alloc(32, 6).toString('base64')),
    };
    await expect(sendEmailJob(data, d)).rejects.toThrow();
    expect(d.sender.sent).toEqual([]);
  });

  it('FON-011: un modello sconosciuto fa fallire il lavoro, senza inviare', async () => {
    const d = deps();
    const data = { to: 'destinatario@example.com', template: 'sconosciuto', data: {} } as unknown as EmailJobData;
    await expect(sendEmailJob(data, d)).rejects.toThrow(/sconosciuto/);
    expect(d.sender.sent).toEqual([]);
  });

  it('FON-002: con EMAIL_PROVIDER=fake il lavoro non chiama l’adattatore del fornitore', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const emailSender = createEmailSender(
      { EMAIL_PROVIDER: 'fake', EMAIL_API_KEY: 'VALORE-PROVA-EMAIL-API-KEY', EMAIL_FROM: 'noreply@example.com' },
      { fetch: fetchMock },
    );
    const result = await sendEmailJob(
      { to: 'destinatario@example.com', template: 'prova', data: {} },
      { sender: emailSender, isSuppressed: async () => false, key },
    );
    expect(result).toMatchObject({ status: 'sent' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((emailSender as FakeEmailSender).sent).toHaveLength(1);
  });

  // Il gestore lavora con `perJobResults` di pg-boss 12: un esito per lavoro (completed con l'esito dell'invio come
  // output, oppure failed con il messaggio d'errore), così un lavoro che fallisce non fa ripetere gli altri del gruppo.
  it('FON-011: il gestore per pg-boss restituisce un esito per ciascun lavoro, e uno che fallisce non trascina gli altri', async () => {
    const d = deps(['escluso@example.com']);
    const handler = createEmailSendHandler(d);
    const results = await handler([
      { id: 'a', data: { to: 'escluso@example.com', template: 'prova', data: {} } },
      { id: 'b', data: { to: 'destinatario@example.com', template: 'prova', data: {} } },
      {
        id: 'c',
        data: { to: 'destinatario@example.com', template: 'sconosciuto', data: {} } as unknown as EmailJobData,
      },
    ]);
    expect(results).toEqual([
      { id: 'a', status: 'completed', output: { status: 'suppressed' } },
      { id: 'b', status: 'completed', output: expect.objectContaining({ status: 'sent' }) },
      { id: 'c', status: 'failed', output: { message: expect.stringContaining('sconosciuto') } },
    ]);
    expect(d.sender.sent.map((message) => message.to)).toEqual(['destinatario@example.com']);
  });
});
