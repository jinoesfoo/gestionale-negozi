// Adattatore Brevo (01 FON-T10): API delle email transazionali, verificata nel piano di FON-T10 sulla documentazione per
// sviluppatori di Brevo («Send a transactional email»): POST https://api.brevo.com/v3/smtp/email, chiave
// nell'intestazione `api-key`, corpo JSON con `sender`, `to`, `subject`, `htmlContent`, `textContent`; risposta 201
// con `messageId`; un errore ha `code` e `message`. Nessuna libreria: `fetch` di Node. Gli errori riportano lo stato e
// il codice di Brevo, mai la chiave, il destinatario o il messaggio di Brevo (che può contenere l'indirizzo, 00 §4.2).
import { isPlaceholder } from '@/config/env';
import type { EmailMessage, EmailSender } from './sender';

export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

export interface BrevoOptions {
  apiKey: string;
  /** L'indirizzo del mittente (EMAIL_FROM, oppure quello scelto per l'email di prova). */
  from: string;
  /** Il nome del mittente mostrato al destinatario. */
  fromName?: string;
  /** Per i test: un fetch finto. */
  fetch?: typeof fetch;
}

/** Il codice d'errore di Brevo (`invalid_parameter`, `unauthorized`, …), se la risposta ne ha uno riconoscibile. */
async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === 'string' && /^[a-z_]{1,60}$/.test(body.code) ? body.code : undefined;
  } catch {
    return undefined;
  }
}

export class BrevoEmailSender implements EmailSender {
  constructor(private readonly options: BrevoOptions) {}

  async send(message: EmailMessage): Promise<{ id?: string }> {
    const { apiKey, from, fromName } = this.options;
    if (isPlaceholder(apiKey)) {
      throw new Error('EMAIL_API_KEY è ancora un segnaposto: per inviare con Brevo serve la chiave vera.');
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const sender = fromName === undefined ? { email: from } : { email: from, name: fromName };
    let response: Response;
    try {
      response = await fetchImpl(BREVO_SEND_URL, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender,
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'errore sconosciuto';
      throw new Error(`Invio con Brevo non riuscito: Brevo non raggiungibile (${reason}).`);
    }
    if (!response.ok) {
      const code = await errorCode(response);
      throw new Error(`Brevo ha rifiutato l'invio: stato ${response.status}${code === undefined ? '' : ` (${code})`}.`);
    }
    try {
      const body = (await response.json()) as { messageId?: unknown };
      return typeof body.messageId === 'string' ? { id: body.messageId } : {};
    } catch {
      return {};
    }
  }
}
