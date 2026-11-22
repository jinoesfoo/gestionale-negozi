import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEmailProbe } from '@/server/email/probe';
import { recognizableValues, validWorkerEnv } from '../../../fixtures/env';

// Email di prova di DOM-012 (nota (3) del piano di FON-T10): `pnpm email:prova <destinatario> <mittente>` invia con il
// nostro adattatore Brevo il modello `prova`, dal mittente indicato (uno su {{DOMINIO}} e uno su {{DOMINIO_TEST}}),
// con le variabili di .env.worker. La lancia l'utente dal suo terminale, con la chiave vera e EMAIL_PROVIDER=brevo:
// con `fake` non invierebbe nulla, quindi si ferma e lo dice. Non scrive mai la chiave.

const API_KEY = 'VALORE-PROVA-BREVO-API-KEY-0123456789';
const brevoEnv = () => ({ ...validWorkerEnv(), EMAIL_PROVIDER: 'brevo', EMAIL_API_KEY: API_KEY });

let output: string[];

beforeEach(() => {
  output = [];
  const capture = (...args: unknown[]) => {
    output.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'log').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('email di prova (pnpm email:prova)', () => {
  it('DOM-012: invia il modello di prova con Brevo dal mittente indicato al destinatario indicato', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ messageId: '<id-prova@brevo>' }), { status: 201 }),
    );
    const code = await runEmailProbe(['casella@example.org', 'noreply@foondaco.it'], brevoEnv(), { fetch: fetchMock });
    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {
      sender: { email: string };
      to: { email: string }[];
      subject: string;
    };
    expect(body.sender.email).toBe('noreply@foondaco.it');
    expect(body.to).toEqual([{ email: 'casella@example.org' }]);
    expect(body.subject.length).toBeGreaterThan(0);
    const text = output.join('\n');
    expect(text).toContain('<id-prova@brevo>');
    expect(text).not.toContain(API_KEY);
  });

  it('DOM-012: con EMAIL_PROVIDER=fake non invia nulla, esce con 1 e chiede EMAIL_PROVIDER=brevo', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const code = await runEmailProbe(['casella@example.org', 'noreply@foondaco.it'], validWorkerEnv(), {
      fetch: fetchMock,
    });
    expect(code).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('EMAIL_PROVIDER');
  });

  it('DOM-012: senza destinatario e mittente validi stampa l’uso ed esce con 2, senza inviare', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    for (const argv of [[], ['casella@example.org'], ['casella@example.org', 'mittente-senza-chiocciola']]) {
      const code = await runEmailProbe(argv, brevoEnv(), { fetch: fetchMock });
      expect(code, argv.join(' ')).toBe(2);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('pnpm email:prova');
  });

  it('DOM-012: con un ambiente del worker non valido esce con 1, nomina la variabile e non scrive valori', async () => {
    const env = { ...brevoEnv(), DATABASE_URL: '' };
    const fetchMock = vi.fn<typeof fetch>();
    const code = await runEmailProbe(['casella@example.org', 'noreply@foondaco.it'], env, { fetch: fetchMock });
    expect(code).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const text = output.join('\n');
    expect(text).toContain('DATABASE_URL');
    for (const value of recognizableValues(env)) expect(text).not.toContain(value);
  });

  it('DOM-012: se Brevo rifiuta l’invio esce con 1, con lo stato, senza la chiave', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), { status: 401 }),
    );
    const code = await runEmailProbe(['casella@example.org', 'noreply@foondaco.it'], brevoEnv(), { fetch: fetchMock });
    expect(code).toBe(1);
    const text = output.join('\n');
    expect(text).toContain('401');
    expect(text).not.toContain(API_KEY);
  });
});
