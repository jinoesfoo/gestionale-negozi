// Avviso ad ADMIN_ALERT_EMAIL alla prima segnalazione di un indirizzo (FON-011): Brevo ha segnalato un rimbalzo
// definitivo, un blocco o una segnalazione di spam, e l'indirizzo non riceverà più email.
import { platform } from '@/config/platform';
import { htmlDocument, paragraph } from './layout';

export interface EmailSuppressedInput {
  data: { email: string; reason: 'bounce' | 'complaint' };
  secrets?: undefined;
}

const REASONS = {
  bounce: 'Brevo ha segnalato un rimbalzo definitivo (indirizzo inesistente o bloccato)',
  complaint: 'il destinatario ha fatto una segnalazione di spam',
} as const;

export function emailSuppressed({ data }: EmailSuppressedInput) {
  const subject = `Indirizzo escluso dagli invii: ${data.email}`;
  const lines = [
    `L'indirizzo ${data.email} è stato escluso dagli invii di ${platform.productName}: ${REASONS[data.reason]}.`,
    'Da ora le email verso questo indirizzo non partono più (il lavoro email.send termina con esito suppressed).',
    "Se l'esclusione è sbagliata, l'indirizzo si toglie a mano dalla tabella email_suppressions.",
  ];
  return {
    subject,
    text: lines.join('\n\n'),
    html: htmlDocument(subject, lines.map(paragraph).join('\n')),
  };
}
