// Registro dei lavori del worker (01 FON-T10, specs/README.md): ogni lavoro ha il suo file in src/server/jobs/ e si
// registra qui, non in src/worker.ts. FON-T10 registra solo `email.send`, senza pianificazioni: ogni compito che scrive
// il gestore di un lavoro periodico registra **insieme** a work() la sua pianificazione (schedule() con
// tz 'Europe/Rome' e l'orario di 05 §Lavori periodici), così non esiste mai una pianificazione senza gestore né un
// gestore senza pianificazione. Le code le crea prima ensureQueues().
import type { PgBoss } from 'pg-boss';
import { EMAIL_SEND_QUEUE, type EmailJobData } from '@/server/email/enqueue';
import { createEmailSendHandler, type EmailSendDeps } from './email-send';

export type JobDeps = EmailSendDeps;

/** Registra i gestori dei lavori sull'istanza pg-boss del worker. */
export async function registerJobs(boss: Pick<PgBoss, 'work'>, deps: JobDeps): Promise<void> {
  await boss.work<EmailJobData>(EMAIL_SEND_QUEUE, { perJobResults: true }, createEmailSendHandler(deps));
}
