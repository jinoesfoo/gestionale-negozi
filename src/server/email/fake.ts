// Fornitore email finto (01 FON-T10, EMAIL_PROVIDER=fake): salva i messaggi in memoria e non invia nulla. Solo per
// sviluppo e CI: lo schema del worker lo rifiuta in prod. Non scrive nel log né destinatari né contenuti (00 §4.2).
import type { EmailMessage, EmailSender } from './sender';

export class FakeEmailSender implements EmailSender {
  /** I messaggi "inviati", in ordine. */
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ id: string }> {
    this.sent.push({ ...message });
    return { id: `fake-${this.sent.length}` };
  }
}
