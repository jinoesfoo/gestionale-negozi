import { describe, expect, it } from 'vitest';
import { TEMPLATE_NAMES, renderEmail } from '@/server/email/templates';

// Modelli delle email in italiano (01 FON-T10, src/server/email/templates/): ogni modello dà oggetto, testo semplice e
// HTML. Nell'HTML ogni valore è scritto con i caratteri speciali sostituiti, così un indirizzo o un link non diventano
// codice. In FON-T10 nascono l'avviso di indirizzo escluso (FON-011) e il modello di prova (email di prova di DOM-012
// e test dei segreti cifrati); gli altri li aggiungono le aree che li usano.

describe('modelli delle email', () => {
  it('FON-011: esistono i modelli email-suppressed e prova', () => {
    expect([...TEMPLATE_NAMES].sort()).toEqual(['email-suppressed', 'prova']);
  });

  it('FON-011: l’avviso di indirizzo escluso nomina l’indirizzo e il motivo, in italiano', () => {
    const bounce = renderEmail('email-suppressed', { data: { email: 'rimbalzo@example.com', reason: 'bounce' } });
    expect(bounce.subject).toContain('rimbalzo@example.com');
    expect(bounce.text).toContain('rimbalzo@example.com');
    expect(bounce.text).toContain('rimbalzo definitivo');
    expect(bounce.html).toContain('rimbalzo@example.com');

    const complaint = renderEmail('email-suppressed', { data: { email: 'spam@example.com', reason: 'complaint' } });
    expect(complaint.text).toContain('segnalazione di spam');
  });

  it('FON-011: il testo semplice non contiene marcatori HTML', () => {
    const email = renderEmail('email-suppressed', { data: { email: 'rimbalzo@example.com', reason: 'bounce' } });
    expect(email.text).not.toMatch(/<[a-z/][^>]*>/i);
    expect(email.html).toMatch(/<[a-z][^>]*>/i);
  });

  it('00§4.3: il modello di prova mostra il link facoltativo, nell’HTML con i caratteri speciali sostituiti', () => {
    const link = 'https://app.localhost/invito/abc?x=1&y="2"<3>';
    const email = renderEmail('prova', { data: {}, secrets: { link } });
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.text).toContain(link);
    expect(email.html).not.toContain(link);
    expect(email.html).toContain('&amp;');
    expect(email.html).toContain('&quot;');
    expect(email.html).toContain('&lt;3&gt;');
    expect(email.html).not.toContain('<3>');
  });

  it('00§4.3: senza link il modello di prova non scrive valori vuoti', () => {
    const email = renderEmail('prova', { data: {} });
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toContain('undefined');
      expect(part).not.toContain('null');
    }
  });

  it('FON-011: un modello sconosciuto è un errore', () => {
    expect(() => renderEmail('sconosciuto' as never, { data: {} } as never)).toThrow(/sconosciuto/);
  });
});
