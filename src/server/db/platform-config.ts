// Valori di configurazione nel database (02 NEG-T01, note (1) e (2) del piano): src/config/platform.ts resta l'unica
// fonte, e src/migrate.ts, dopo le migrazioni e con le credenziali del proprietario, ne scrive in platform_config le
// voci che le funzioni di piattaforma e il worker leggono (platform_config_get(), U e W), così un chiamante non può
// abbreviare conservazione e tolleranza. Il client del proprietario lo riceve chi chiama: questo file non lo importa
// (00 R-DATI-3).
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { platform } from '@/config/platform';
import { platformConfig } from './schema';

export interface PlatformConfigEntry {
  /** Il nome in src/config/platform.ts, con il punto per i valori annidati (`invoicing.regime`). */
  key: string;
  value: number | string;
}

/** Le voci di platform_config, con i valori di src/config/platform.ts. */
export function platformConfigEntries(): PlatformConfigEntry[] {
  return [
    { key: 'closedRetentionDays', value: platform.closedRetentionDays },
    { key: 'suspendedDaysBeforeClose', value: platform.suspendedDaysBeforeClose },
    { key: 'graceDays', value: platform.graceDays },
    { key: 'exportRetentionDays', value: platform.exportRetentionDays },
    { key: 'trialInactiveDaysBeforeClose', value: platform.trialInactiveDaysBeforeClose },
    { key: 'invoicing.regime', value: platform.invoicing.regime },
    { key: 'invoicing.bolloThresholdCents', value: platform.invoicing.bolloThresholdCents },
    { key: 'invoicing.bolloCents', value: platform.invoicing.bolloCents },
  ];
}

/**
 * Scrive le voci in platform_config (upsert, in un'unica istruzione): una chiave già presente prende il valore nuovo,
 * una chiave non elencata resta com'è. Senza voci non fa nulla.
 */
export async function syncPlatformConfig(
  db: NodePgDatabase,
  entries: readonly PlatformConfigEntry[] = platformConfigEntries(),
): Promise<void> {
  if (entries.length === 0) return;
  await db
    .insert(platformConfig)
    .values(entries.map(({ key, value }) => ({ key, value })))
    .onConflictDoUpdate({ target: platformConfig.key, set: { value: sql`excluded.value` } });
}
