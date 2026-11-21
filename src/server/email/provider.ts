// Scelta del fornitore email (01 §Variabili d'ambiente, FON-T10): EMAIL_PROVIDER sceglie l'implementazione di
// EmailSender usata da `email.send`. `brevo` invia davvero (anche dal server di test, 06 §DNS); `fake` salva in
// memoria e non invia nulla (sviluppo e CI; lo schema lo rifiuta in prod).
import type { WorkerEnv } from '@/config/env';
import { platform } from '@/config/platform';
import { BrevoEmailSender } from './brevo';
import { FakeEmailSender } from './fake';
import type { EmailSender } from './sender';

export type EmailProviderEnv = Pick<WorkerEnv, 'EMAIL_PROVIDER' | 'EMAIL_API_KEY' | 'EMAIL_FROM'>;

export function createEmailSender(env: EmailProviderEnv, options: { fetch?: typeof fetch } = {}): EmailSender {
  if (env.EMAIL_PROVIDER === 'fake') return new FakeEmailSender();
  return new BrevoEmailSender({
    apiKey: env.EMAIL_API_KEY,
    from: env.EMAIL_FROM,
    fromName: platform.productName,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
