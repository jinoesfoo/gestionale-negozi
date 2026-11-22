// Il lavoro `email.send` (01 FON-T10, FON-011). Prima di inviare legge `email_suppressions`: verso un indirizzo escluso
// termina senza invio, con esito `suppressed`. Altrimenti apre i segreti cifrati del lavoro (00 §4.3), compone il
// messaggio con il modello e lo invia con l'EmailSender scelto da EMAIL_PROVIDER. Il gestore per pg-boss lavora con
// `perJobResults` (nota (11) della fase test): un esito per lavoro, così un'email che fallisce non fa ripetere le altre.
import type { JobResult } from 'pg-boss';
import { errorMessage } from '@/lib/errors';
import type { EmailJobData } from '@/server/email/enqueue';
import type { EmailSender } from '@/server/email/sender';
import { isTemplateName, renderEmail, type TemplateInputs } from '@/server/email/templates';
import { openJobSecret } from './seal';

export type EmailSendResult = { status: 'sent'; id?: string } | { status: 'suppressed' };

export interface EmailSendDeps {
  sender: EmailSender;
  /** Vero se l'indirizzo (in minuscolo) è in email_suppressions. */
  isSuppressed(email: string): Promise<boolean>;
  /** Per i test: la chiave dei segreti; senza, JOB_PAYLOAD_KEY dell'ambiente. */
  key?: string;
}

/**
 * I segreti decifrati del lavoro, che devono essere un oggetto JSON. L'errore è generico e non riporta il messaggio di
 * JSON.parse, che cita l'inizio del testo in chiaro e finirebbe nel log e nell'esito in pgboss.job (00 §4.2, §4.3;
 * nota (20) di 01).
 */
function parseSecrets(plaintext: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error('Segreti del lavoro non leggibili: non sono JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Segreti del lavoro non leggibili: non sono un oggetto JSON.');
  }
  return parsed as Record<string, unknown>;
}

/** Elabora un lavoro `email.send`. */
export async function sendEmailJob(data: EmailJobData, deps: EmailSendDeps): Promise<EmailSendResult> {
  const to = data.to.trim();
  if (await deps.isSuppressed(to.toLowerCase())) return { status: 'suppressed' };
  if (!isTemplateName(data.template)) throw new Error(`Modello email sconosciuto: ${String(data.template)}.`);
  const secrets = data.secrets === undefined ? undefined : parseSecrets(openJobSecret(data.secrets, deps.key));
  const input = { data: data.data, secrets } as unknown as TemplateInputs[typeof data.template];
  const message = renderEmail(data.template, input);
  const result = await deps.sender.send({ to, ...message });
  return result.id === undefined ? { status: 'sent' } : { status: 'sent', id: result.id };
}

/** Il gestore per `work('email.send', { perJobResults: true }, …)`: un esito per ciascun lavoro ricevuto. */
export function createEmailSendHandler(deps: EmailSendDeps) {
  return async (jobs: ReadonlyArray<{ id: string; data: EmailJobData }>): Promise<JobResult[]> => {
    const results: JobResult[] = [];
    for (const job of jobs) {
      try {
        results.push({ id: job.id, status: 'completed', output: await sendEmailJob(job.data, deps) });
      } catch (error) {
        // Il messaggio non contiene chiavi né destinatari (adattatore, segreti e modelli li tengono fuori).
        const message = errorMessage(error);
        console.error(`Lavoro email.send non riuscito: ${message}`);
        results.push({ id: job.id, status: 'failed', output: { message } });
      }
    }
    return results;
  };
}
