// Scritture di servizio esenti dal registro delle azioni (08 OPS-020): contatori e date tecniche che non sono azioni di
// una persona. Nasce in FON-T10 con il primo helper audit(); ogni area aggiunge qui le proprie, con il motivo, quando
// scrive la funzione o il lavoro (per esempio `stripe_event_record`, le prenotazioni di `trials_ending`,
// `shop_touch_activity`). A FON-T10 nessuna scrittura esente esiste ancora (nota (6) del piano): le scritture di questo
// compito (esclusioni dal webhook delle email) si registrano con `email_suppressed`.

export interface AuditExemption {
  /** La funzione di piattaforma, la tabella o il lavoro che scrive. */
  readonly write: string;
  /** Perché non è un'azione da registrare. */
  readonly reason: string;
}

export const AUDIT_EXEMPT: readonly AuditExemption[] = [];
