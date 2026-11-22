// Valori di configurazione della piattaforma e segnaposto del prodotto (specs/README.md,
// «Convenzioni di scrittura»). Nessun segreto: i segreti stanno solo nelle variabili d'ambiente.
// Il dominio di ciascun ambiente sta in PUBLIC_BASE_DOMAIN; qui c'è il dominio principale.
// Dopo FON-T01 ogni compito cambia solo la riga della propria chiave.

export const platform = {
  /** {{PRODOTTO}}: nome del prodotto. */
  productName: 'foondaco',
  /** {{SLUG}}: nome breve senza spazi. */
  slug: 'foondaco',
  /** {{DOMINIO}}: dominio principale (produzione). */
  domain: 'foondaco.com',

  /** Sottodomini che un negozio non può prendere; il CHECK su `shops` li replica (02 NEG-001). */
  reservedSubdomains: ['admin', 'app', 'clienti', 'www', 'api', 'mail', 'status', 'test', 'static', 'cdn', 'n'],

  // --- Ciclo di vita del negozio (02, 05); migrate.ts li copia in platform_config (NEG-T01) ---
  /** Giorni di tolleranza dopo un pagamento fallito prima della sospensione (05). */
  graceDays: 7,
  /** Giorni in `suspended` prima dell'annullamento e della chiusura (05). */
  suspendedDaysBeforeClose: 60,
  /** Giorni in `closed`, con la sola esportazione, prima della cancellazione dei dati (05). */
  closedRetentionDays: 30,
  /** Giorni di conservazione dei file di esportazione (02, 08 OPS-031). */
  exportRetentionDays: 7,
  /** Giorni di inattività dopo i quali un negozio in prova senza abbonamento si chiude (07 ADM-013). */
  trialInactiveDaysBeforeClose: 60,

  // --- Moduli (04) ---
  /** Durata predefinita della prova di un modulo concessa dall'amministratore (MOD-007). */
  moduleTrialDays: 14,
  /** Moduli scrivibili mentre il negozio è sospeso (MOD-006). */
  suspendedWritableModules: ['cassa'],

  // --- Fatturazione (05) ---
  /** Anni di conservazione di `issued_invoices_archive` (nessuna cancellazione automatica in fase 0). */
  issuedInvoicesRetentionYears: 10,
  invoicing: {
    /** Dicitura del regime forfettario sulle fatture [VERIFICA con il commercialista, 05]. */
    regime: "Operazione senza applicazione dell'IVA ai sensi dell'art. 1, commi 54-89, L. 190/2014",
    /** Importo oltre il quale si applica la marca da bollo (77,47 €). */
    bolloThresholdCents: 7747,
    /** Importo della marca da bollo (2,00 €). */
    bolloCents: 200,
  },

  // --- Accesso (03 ACC-004) ---
  /** Limiti per IP delle richieste agli endpoint di accesso (finestra in secondi). */
  rateLimit: {
    signIn: { window: 900, max: 10 },
    twoFactor: { window: 900, max: 10 },
    passwordReset: { window: 900, max: 5 },
  },
  /** Tentativi falliti del secondo fattore, per utente, in una finestra che parte dal primo fallimento. */
  twoFactorFailures: {
    /** Dopo questi tentativi ogni nuovo tentativo attende min(2^(n−5), maxDelaySeconds) secondi. */
    slowdownAfter: 5,
    maxDelaySeconds: 60,
    /** Al tentativo numero alertEmailAt parte l'email all'utente, una volta per finestra. */
    alertEmailAt: 10,
    /** Oltre questi tentativi ogni tentativo è rifiutato fino alla fine della finestra. */
    lockAfter: 30,
    windowHours: 24,
  },

  // --- Pannello (07 ADM-009) ---
  /** URL del progetto nel pannello Sentry (non il DSN); se assente la pagina Sistema non mostra il link. */
  sentryProjectUrl: undefined as string | undefined,
} as const;

export type Platform = typeof platform;
