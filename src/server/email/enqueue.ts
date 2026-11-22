// Accodamento delle email (01 FON-T10, 00 §4.3). Tutte le email partono dal lavoro `email.send` del worker: chi le
// manda le accoda soltanto, **dopo il commit** della transazione che le provoca. I segreti (per esempio un link con un
// token) viaggiano nel campo `secrets`, cifrato con JOB_PAYLOAD_KEY: in pgboss.job non compaiono in chiaro. Il lavoro
// si cancella un'ora dopo il completamento (`deleteAfterSeconds`, verificata in pg-boss 12.38).
import { sealJobSecret } from '@/server/jobs/seal';
import type { TemplateInputs, TemplateName } from './templates';

export const EMAIL_SEND_QUEUE = 'email.send';
export const EMAIL_JOB_DELETE_AFTER_SECONDS = 3600;

/** I dati del lavoro `email.send`, come stanno in pgboss.job. */
export interface EmailJobData {
  to: string;
  template: TemplateName;
  data: Record<string, unknown>;
  /** I segreti del modello, in JSON, cifrati con sealJobSecret. */
  secrets?: string;
}

/** Un'email da accodare: destinatario, modello e i suoi dati (e segreti). */
export type EmailToSend<T extends TemplateName> = { to: string; template: T } & TemplateInputs[T];

/** La sola operazione di pg-boss che serve (la ha l'istanza PgBoss). */
export interface JobSender {
  send(name: string, data: object, options: { deleteAfterSeconds: number }): Promise<string | null>;
}

/** Accoda l'email; restituisce l'id del lavoro. */
export async function enqueueEmail<T extends TemplateName>(
  boss: JobSender,
  email: EmailToSend<T>,
  options: { key?: string } = {},
): Promise<string | null> {
  const job: EmailJobData = { to: email.to, template: email.template, data: email.data };
  const secrets = email.secrets as Record<string, unknown> | undefined;
  if (secrets !== undefined && Object.keys(secrets).length > 0) {
    job.secrets = sealJobSecret(JSON.stringify(secrets), options.key);
  }
  return boss.send(EMAIL_SEND_QUEUE, job, { deleteAfterSeconds: EMAIL_JOB_DELETE_AFTER_SECONDS });
}
