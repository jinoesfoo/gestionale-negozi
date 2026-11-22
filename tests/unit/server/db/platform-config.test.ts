import { describe, expect, it } from 'vitest';
import { platform } from '@/config/platform';
import { platformConfigEntries } from '@/server/db/platform-config';

// Valori di configurazione nel database (02 NEG-T01, nota (1) del piano): src/migrate.ts scrive a ogni esecuzione in
// platform_config le coppie di platformConfigEntries(), lette da src/config/platform.ts, che resta l'unica fonte. Le
// chiavi sono i nomi del file, con il punto per quelle annidate (`invoicing.regime`, come in 05); i valori restano numeri
// o testo (colonna jsonb).

describe('valori di platform_config', () => {
  it('NEG-006: platformConfigEntries() dà le 8 chiavi di platform_config con i valori di src/config/platform.ts', () => {
    const entries = platformConfigEntries();
    expect(entries).toHaveLength(8);
    expect(Object.fromEntries(entries.map((entry) => [entry.key, entry.value]))).toEqual({
      closedRetentionDays: platform.closedRetentionDays,
      suspendedDaysBeforeClose: platform.suspendedDaysBeforeClose,
      graceDays: platform.graceDays,
      exportRetentionDays: platform.exportRetentionDays,
      trialInactiveDaysBeforeClose: platform.trialInactiveDaysBeforeClose,
      'invoicing.regime': platform.invoicing.regime,
      'invoicing.bolloThresholdCents': platform.invoicing.bolloThresholdCents,
      'invoicing.bolloCents': platform.invoicing.bolloCents,
    });
  });

  it('NEG-006: i valori che la specifica fissa arrivano tali e quali (60 giorni, soglia del bollo 7747, bollo 200)', () => {
    const values = new Map(platformConfigEntries().map((entry) => [entry.key, entry.value]));
    expect(values.get('trialInactiveDaysBeforeClose')).toBe(60);
    expect(values.get('invoicing.bolloThresholdCents')).toBe(7747);
    expect(values.get('invoicing.bolloCents')).toBe(200);
    expect(typeof values.get('invoicing.regime')).toBe('string');
  });
});
