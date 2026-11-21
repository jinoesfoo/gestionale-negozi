import { describe, expect, it, vi } from 'vitest';
import { BREVO_SEND_URL, BrevoEmailSender } from '@/server/email/brevo';

// Adattatore del fornitore email (01 FON-T10, 00 §1 «Email»: il fornitore si cambia in un file). Brevo, API delle
// email transazionali (documentazione per sviluppatori, «Send a transactional email», verificata nel piano di FON-T10):
// POST https://api.brevo.com/v3/smtp/email, chiave nell'intestazione `api-key`, corpo JSON con `sender`, `to`,
// `subject`, `htmlContent`, `textContent`; risposta 201 con `messageId`; un errore 400 ha `code` e `message`.
// I messaggi d'errore non contengono la chiave né il destinatario (00 §4.2).

const API_KEY = 'VALORE-PROVA-BREVO-API-KEY-0123456789';
const MESSAGE = {
  to: 'destinatario@example.com',
  subject: 'Oggetto di prova',
  text: 'Testo di prova',
  html: '<p>Testo di prova</p>',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sender(fetchImpl: typeof fetch, apiKey = API_KEY) {
  return new BrevoEmailSender({ apiKey, from: 'noreply@example.com', fromName: 'Mittente di prova', fetch: fetchImpl });
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("l'invio doveva fallire");
}

describe('adattatore Brevo', () => {
  it('FON-011: invia con POST all’API delle email transazionali, con la chiave nell’intestazione api-key', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(201, { messageId: '<id-di-prova@brevo>' }));
    const result = await sender(fetchMock).send(MESSAGE);

    expect(BREVO_SEND_URL).toBe('https://api.brevo.com/v3/smtp/email');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(BREVO_SEND_URL);
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('api-key')).toBe(API_KEY);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { email: 'noreply@example.com', name: 'Mittente di prova' },
      to: [{ email: 'destinatario@example.com' }],
      subject: 'Oggetto di prova',
      htmlContent: '<p>Testo di prova</p>',
      textContent: 'Testo di prova',
    });
    expect(result).toEqual({ id: '<id-di-prova@brevo>' });
  });

  it('FON-011: una risposta d’errore fa fallire l’invio con lo stato e il codice, senza chiave né destinatario', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(400, { code: 'invalid_parameter', message: 'email is not valid for destinatario@example.com' }),
    );
    const error = await failure(sender(fetchMock).send(MESSAGE));
    expect(error.message).toContain('400');
    expect(error.message).toContain('invalid_parameter');
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain('destinatario@example.com');
  });

  it('FON-011: anche un errore senza corpo JSON (per esempio 500) fa fallire l’invio', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('errore interno', { status: 500 }));
    const error = await failure(sender(fetchMock).send(MESSAGE));
    expect(error.message).toContain('500');
  });

  it('FON-011: con la chiave ancora segnaposto non chiama Brevo e lo dice nominando EMAIL_API_KEY', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const error = await failure(sender(fetchMock, 'placeholder-email-api-key').send(MESSAGE));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error.message).toContain('EMAIL_API_KEY');
    expect(error.message).not.toContain('placeholder-email-api-key');
  });

  it('FON-011: un errore di rete fa fallire l’invio senza scrivere la chiave', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    const error = await failure(sender(fetchMock).send(MESSAGE));
    expect(error.message).not.toContain(API_KEY);
  });
});
