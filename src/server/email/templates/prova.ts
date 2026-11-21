// Email di prova (nota (3) del piano di FON-T10): la manda `pnpm email:prova` per controllare SPF, DKIM e DMARC
// (DOM-012). Il link facoltativo è un segreto del lavoro (00 §4.3): serve ai test dei segreti cifrati in coda.
import { platform } from '@/config/platform';
import { escapeHtml, htmlDocument, paragraph } from './layout';

export interface ProvaInput {
  data: Record<string, never>;
  secrets?: { link?: string } | undefined;
}

export function prova({ secrets }: ProvaInput) {
  const subject = `Email di prova di ${platform.productName}`;
  const intro =
    `Questa è un'email di prova inviata da ${platform.productName} con Brevo, per controllare ` +
    'che SPF, DKIM e DMARC risultino superati (pass) nelle intestazioni ricevute.';
  const link = secrets?.link;
  const text = link === undefined ? intro : `${intro}\n\nLink di prova: ${link}`;
  const html = htmlDocument(
    subject,
    [
      paragraph(intro),
      link === undefined ? '' : `<p>Link di prova: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    ]
      .filter((part) => part !== '')
      .join('\n'),
  );
  return { subject, text, html };
}
