// Parti comuni dei modelli delle email: la sostituzione dei caratteri speciali nell'HTML e la cornice del messaggio.
import { platform } from '@/config/platform';

/** Il testo con i caratteri speciali dell'HTML sostituiti: un valore (indirizzo, link) non diventa mai codice. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Il corpo HTML completo, con il nome del prodotto in fondo. `body` è HTML già sicuro, composto con escapeHtml. */
export function htmlDocument(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="it">',
    `<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>`,
    '<body style="font-family: sans-serif; line-height: 1.5; color: #1a1a1a;">',
    body,
    `<p style="color: #666; font-size: 0.9em;">${escapeHtml(platform.productName)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Un paragrafo HTML dal testo semplice. */
export function paragraph(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}
