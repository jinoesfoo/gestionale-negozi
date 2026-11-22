import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleEmailWebhook, type EmailWebhookDeps } from '@/server/email/webhook';

// Webhook dei rimbalzi (FON-011, 01 FON-T10): POST /api/webhooks/email?k=<EMAIL_WEBHOOK_TOKEN>. Brevo non firma le
// chiamate (esito del [VERIFICA] nel piano di FON-T10): il token nella query, confrontato a tempo costante, è il primo
// livello; senza token o con un token sbagliato la risposta è 403 e non si scrive nulla. Eventi di Brevo (nota (1) del
// piano): `hard_bounce` → bounce, `spam` → complaint, `blocked` → bounce; gli altri ricevono 200 senza effetti. Il
// corpo può essere un evento o un elenco di eventi. L'avviso ad ADMIN_ALERT_EMAIL parte solo se la riga è nuova, dopo
// il commit; se il suo accodamento fallisce, la risposta resta 200 e il log non scrive l'indirizzo (nota (5)).

const TOKEN = 'VALORE-PROVA-EMAIL-WEBHOOK-0123456789abcdef';

function deps(newRows = true): EmailWebhookDeps & {
  record: ReturnType<typeof vi.fn<EmailWebhookDeps['record']>>;
  alert: ReturnType<typeof vi.fn<EmailWebhookDeps['alert']>>;
} {
  return {
    token: TOKEN,
    record: vi.fn<EmailWebhookDeps['record']>(async () => newRows),
    alert: vi.fn<EmailWebhookDeps['alert']>(async () => undefined),
  };
}

function request(body: unknown, k: string | null = TOKEN): Request {
  const url = new URL('https://example.com/api/webhooks/email');
  if (k !== null) url.searchParams.set('k', k);
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const event = (type: string, email: string) => ({ event: type, email, date: '2026-11-21 10:00:00', ts_event: 1 });

let output: string[];

beforeEach(() => {
  output = [];
  const capture = (...args: unknown[]) => {
    output.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'log').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webhook dei rimbalzi', () => {
  // Dalla revisione di FON-T10: un EMAIL_WEBHOOK_TOKEN ancora segnaposto (`placeholder…`, che lo schema ammette) non
  // protegge nulla, perché sta negli esempi: il webhook rifiuta ogni chiamata, anche quella che presenta proprio quel
  // valore, come l'adattatore Brevo rifiuta la sua chiave segnaposto.
  it('FON-011: con EMAIL_WEBHOOK_TOKEN ancora segnaposto risponde 403 a ogni chiamata, anche con quel token, e non scrive nulla', async () => {
    const placeholder = 'placeholder-email-webhook-token-0123456789';
    const d = { ...deps(), token: placeholder };
    for (const k of [placeholder, TOKEN, null]) {
      const response = await handleEmailWebhook(request(event('hard_bounce', 'x@example.com'), k), d);
      expect(response.status, String(k)).toBe(403);
    }
    expect(d.record).not.toHaveBeenCalled();
    expect(d.alert).not.toHaveBeenCalled();
  });

  it('FON-011: senza token risponde 403 e non scrive nulla', async () => {
    const d = deps();
    const response = await handleEmailWebhook(request(event('hard_bounce', 'x@example.com'), null), d);
    expect(response.status).toBe(403);
    expect(d.record).not.toHaveBeenCalled();
    expect(d.alert).not.toHaveBeenCalled();
  });

  it('FON-011: con un token sbagliato (più corto, della stessa lunghezza o vuoto) risponde 403 e non scrive nulla', async () => {
    const sameLength = TOKEN.slice(0, -1) + (TOKEN.endsWith('f') ? 'e' : 'f');
    for (const k of ['corto', sameLength, '', TOKEN + 'x']) {
      const d = deps();
      const response = await handleEmailWebhook(request(event('hard_bounce', 'x@example.com'), k), d);
      expect(response.status, k).toBe(403);
      expect(d.record, k).not.toHaveBeenCalled();
    }
  });

  it('FON-011: hard_bounce registra l’indirizzo in minuscolo come bounce e accoda l’avviso una volta', async () => {
    const d = deps(true);
    const response = await handleEmailWebhook(request(event('hard_bounce', '  Rimbalzo@Example.COM ')), d);
    expect(response.status).toBe(200);
    expect(d.record).toHaveBeenCalledExactlyOnceWith('rimbalzo@example.com', 'bounce');
    expect(d.alert).toHaveBeenCalledExactlyOnceWith('rimbalzo@example.com', 'bounce');
  });

  it('FON-011: spam vale complaint e blocked vale bounce', async () => {
    const d = deps(true);
    await handleEmailWebhook(request(event('spam', 'spam@example.com')), d);
    await handleEmailWebhook(request(event('blocked', 'bloccato@example.com')), d);
    expect(d.record.mock.calls).toEqual([
      ['spam@example.com', 'complaint'],
      ['bloccato@example.com', 'bounce'],
    ]);
  });

  it('FON-011: una segnalazione già registrata risponde 200 senza un nuovo avviso', async () => {
    const d = deps(false);
    const response = await handleEmailWebhook(request(event('hard_bounce', 'ripetuto@example.com')), d);
    expect(response.status).toBe(200);
    expect(d.record).toHaveBeenCalledTimes(1);
    expect(d.alert).not.toHaveBeenCalled();
  });

  it('FON-011: gli altri eventi di Brevo ricevono 200 senza effetti', async () => {
    for (const type of ['delivered', 'request', 'soft_bounce', 'invalid_email', 'unsubscribed', 'opened', 'click']) {
      const d = deps();
      const response = await handleEmailWebhook(request(event(type, 'x@example.com')), d);
      expect(response.status, type).toBe(200);
      expect(d.record, type).not.toHaveBeenCalled();
    }
  });

  it('FON-011: un elenco di eventi (webhook raggruppati) li elabora tutti', async () => {
    const d = deps(true);
    const body = [
      event('hard_bounce', 'uno@example.com'),
      event('delivered', 'due@example.com'),
      event('spam', 'tre@example.com'),
    ];
    const response = await handleEmailWebhook(request(body), d);
    expect(response.status).toBe(200);
    expect(d.record.mock.calls).toEqual([
      ['uno@example.com', 'bounce'],
      ['tre@example.com', 'complaint'],
    ]);
    expect(d.alert).toHaveBeenCalledTimes(2);
  });

  it('FON-011: un evento senza indirizzo valido si ignora', async () => {
    const d = deps();
    for (const email of [undefined, '', 'senza-chiocciola', 42]) {
      const response = await handleEmailWebhook(request({ event: 'hard_bounce', email }), d);
      expect(response.status).toBe(200);
    }
    expect(d.record).not.toHaveBeenCalled();
  });

  it('FON-011: un corpo che non è JSON risponde 400 e non scrive nulla', async () => {
    const d = deps();
    const response = await handleEmailWebhook(request('{non è json'), d);
    expect(response.status).toBe(400);
    expect(d.record).not.toHaveBeenCalled();
  });

  it('FON-011: se l’avviso non si accoda la segnalazione resta registrata, risponde 200 e il log non scrive l’indirizzo', async () => {
    const d = deps(true);
    d.alert.mockRejectedValueOnce(new Error('coda non raggiungibile'));
    const response = await handleEmailWebhook(request(event('hard_bounce', 'avviso-perso@example.com')), d);
    expect(response.status).toBe(200);
    expect(d.record).toHaveBeenCalledTimes(1);
    expect(output.join('\n')).not.toBe('');
    expect(output.join('\n')).not.toContain('avviso-perso@example.com');
  });

  it('FON-011: se la registrazione fallisce risponde 500 (Brevo riprova) e il log non scrive l’indirizzo', async () => {
    const d = deps(true);
    d.record.mockRejectedValueOnce(new Error('database non raggiungibile'));
    const response = await handleEmailWebhook(request(event('hard_bounce', 'db-giu@example.com')), d);
    expect(response.status).toBe(500);
    expect(d.alert).not.toHaveBeenCalled();
    expect(output.join('\n')).not.toContain('db-giu@example.com');
  });
});
