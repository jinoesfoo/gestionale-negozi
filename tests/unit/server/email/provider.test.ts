import { describe, expect, it, vi } from 'vitest';
import { BrevoEmailSender } from '@/server/email/brevo';
import { FakeEmailSender } from '@/server/email/fake';
import { createEmailSender } from '@/server/email/provider';

// Scelta del fornitore email (01 §Variabili d'ambiente, FON-T10): EMAIL_PROVIDER sceglie l'implementazione di
// EmailSender usata da `email.send`; con `fake` il worker usa FakeEmailSender, che salva i messaggi in memoria e non
// invia nulla (solo sviluppo e CI: lo schema rifiuta `fake` in prod).

const MESSAGE = { to: 'destinatario@example.com', subject: 'Oggetto', text: 'Testo', html: '<p>Testo</p>' };
const base = { EMAIL_API_KEY: 'VALORE-PROVA-EMAIL-API-KEY', EMAIL_FROM: 'noreply@example.com' };

describe('scelta del fornitore email', () => {
  it('FON-002: con EMAIL_PROVIDER=fake l’invio salva il messaggio in memoria e non chiama l’adattatore del fornitore', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const emailSender = createEmailSender({ ...base, EMAIL_PROVIDER: 'fake' }, { fetch: fetchMock });
    expect(emailSender).toBeInstanceOf(FakeEmailSender);
    await emailSender.send(MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((emailSender as FakeEmailSender).sent).toEqual([MESSAGE]);
  });

  it('FON-002: con EMAIL_PROVIDER=brevo usa l’adattatore Brevo', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ messageId: '<id@brevo>' }), { status: 201 }),
    );
    const emailSender = createEmailSender({ ...base, EMAIL_PROVIDER: 'brevo' }, { fetch: fetchMock });
    expect(emailSender).toBeInstanceOf(BrevoEmailSender);
    await emailSender.send(MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('FON-011: FakeEmailSender dà a ogni messaggio un id diverso e li conserva in ordine', async () => {
    const fake = new FakeEmailSender();
    const first = await fake.send(MESSAGE);
    const second = await fake.send({ ...MESSAGE, to: 'altro@example.com' });
    expect(first.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    expect(fake.sent.map((message) => message.to)).toEqual(['destinatario@example.com', 'altro@example.com']);
  });
});
