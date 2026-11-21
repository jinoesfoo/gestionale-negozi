// Interfaccia del fornitore email (00 §1 «Email», 01 FON-T10): il fornitore si cambia in un file. Tutte le email
// partono dal lavoro `email.send` del worker, che sceglie l'implementazione con EMAIL_PROVIDER (provider.ts).

/** Un messaggio già composto dal modello: il mittente lo aggiunge l'implementazione (EMAIL_FROM). */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  /** Invia il messaggio; restituisce l'id del fornitore, se c'è. Un errore non contiene chiavi né destinatari. */
  send(message: EmailMessage): Promise<{ id?: string }>;
}
