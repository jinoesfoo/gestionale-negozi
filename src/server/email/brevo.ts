// Adattatore Brevo (01 FON-T10): API delle email transazionali, verificata nel piano di FON-T10 sulla documentazione per
// sviluppatori di Brevo («Send a transactional email»): POST https://api.brevo.com/v3/smtp/email, chiave
// nell'intestazione `api-key`, corpo JSON con `sender`, `to`, `subject`, `htmlContent`, `textContent`; risposta 201
// con `messageId`; un errore ha `code` e `message`. Nessuna libreria: `fetch` di Node. Gli errori riportano lo stato,
// il codice e il messaggio di Brevo, che dice il motivo (per esempio un account non ancora abilitato all'invio), con
// l'indirizzo del destinatario sostituito da <destinatario> e una lunghezza massima; mai la chiave (00 §4.2).
import { isPlaceholder } from '@/config/env';
import type { EmailMessage, EmailSender } from './sender';

/** Lunghezza massima del messaggio di Brevo riportato in un errore. */
const MAX_DETAIL_LENGTH = 300;

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

/**
 * Il codice d'errore di Brevo (`invalid_parameter`, `permission_denied`, …), se riconoscibile, e il suo messaggio, con
 * il destinatario mascherato (in qualunque combinazione di maiuscole), su una riga e accorciato.
 */
async function errorDetails(response: Response, to: string): Promise<{ code?: string; detail?: string }> {
  let body: { code?: unknown; message?: unknown };
  try {
    body = (await response.json()) as { code?: unknown; message?: unknown };
  } catch {
    return {};
  }
  const details: { code?: string; detail?: string } = {};
  if (typeof body.code === 'string' && /^[a-z_]{1,60}$/.test(body.code)) details.code = body.code;
  if (typeof body.message === 'string' && body.message.trim() !== '') {
    const escaped = to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const masked = to === '' ? body.message : body.message.replace(new RegExp(escaped, 'gi'), '<destinatario>');
    details.detail = masked.replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL_LENGTH);
  }
  return details;
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
      const { code, detail } = await errorDetails(response, message.to);
      throw new Error(
        `Brevo ha rifiutato l'invio: stato ${response.status}${code === undefined ? '' : ` (${code})`}` +
          `${detail === undefined ? '' : `: ${detail}`}`,
      );
    }
    try {
      const body = (await response.json()) as { messageId?: unknown };
      return typeof body.messageId === 'string' ? { id: body.messageId } : {};
    } catch {
      return {};
    }
  }
}
