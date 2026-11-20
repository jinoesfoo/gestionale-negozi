import { describe, expect, it } from 'vitest';
import { hasPlaceholders } from '@/config/env';

// FON-009: il campo `placeholders` di /api/health è vero se qualche variabile ha ancora un valore segnaposto
// dell'avvio iniziale (`placeholder…`, solo nelle variabili ammesse: 01 §Variabili d'ambiente), senza dire quale.

describe('hasPlaceholders', () => {
  it('FON-009: vero se una variabile ammessa ha ancora un segnaposto', () => {
    expect(
      hasPlaceholders({
        STRIPE_SECRET_KEY: 'sk_test_valore-di-prova',
        STRIPE_WEBHOOK_SECRET: 'placeholder-stripe-webhook',
        HEALTH_TOKEN: 'token-di-prova',
      }),
    ).toBe(true);
    expect(hasPlaceholders({ SENTRY_DSN: 'placeholder' })).toBe(true);
    expect(hasPlaceholders({ SDI_API_URL: 'placeholder-sdi' })).toBe(true);
  });

  it('FON-009: falso quando nessuna variabile ha un segnaposto', () => {
    expect(
      hasPlaceholders({
        STRIPE_SECRET_KEY: 'sk_test_valore-di-prova',
        STRIPE_WEBHOOK_SECRET: 'whsec_valore-di-prova',
        SENTRY_DSN: 'https://chiave@o0.ingest.example/1',
        EMAIL_WEBHOOK_TOKEN: 'token-di-prova-0123456789abcdef0123456789',
      }),
    ).toBe(false);
    expect(hasPlaceholders({})).toBe(false);
  });

  it('FON-009: un valore che contiene placeholder senza iniziare così non è un segnaposto', () => {
    expect(hasPlaceholders({ STRIPE_WEBHOOK_SECRET: 'whsec_placeholder' })).toBe(false);
  });

  it('FON-009: una variabile vuota o assente non conta', () => {
    expect(hasPlaceholders({ STRIPE_PORTAL_CONFIGURATION_ID: '', SDI_API_KEY: undefined })).toBe(false);
  });
});
