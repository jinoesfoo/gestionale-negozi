// POST /api/webhooks/email?k=<EMAIL_WEBHOOK_TOKEN> (FON-011, 01 FON-T10): rimbalzi e segnalazioni di spam di Brevo.
// La logica sta in src/server/email/webhook.ts; qui solo i collegamenti: il token dell'ambiente (validato all'avvio
// dell'app), la registrazione in email_suppressions con la riga di registro (src/server/db/) e l'avviso ad
// ADMIN_ALERT_EMAIL, accodato con `email.send` dopo il commit.
import { recordEmailSuppression } from '@/server/db/email-suppressions';
import { enqueueEmail } from '@/server/email/enqueue';
import { handleEmailWebhook } from '@/server/email/webhook';
import { getAppBoss } from '@/server/jobs/app-boss';

export const runtime = 'nodejs';

function adminAlertEmail(): string {
  const value = process.env.ADMIN_ALERT_EMAIL;
  if (value === undefined || value === '') throw new Error('Manca ADMIN_ALERT_EMAIL.');
  return value;
}

export async function POST(request: Request): Promise<Response> {
  return handleEmailWebhook(request, {
    token: process.env.EMAIL_WEBHOOK_TOKEN ?? '',
    record: recordEmailSuppression,
    alert: async (email, reason) => {
      await enqueueEmail(await getAppBoss(), {
        to: adminAlertEmail(),
        template: 'email-suppressed',
        data: { email, reason },
      });
    },
  });
}
