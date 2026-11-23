// Valori di conservazione e tolleranza e dati delle fatture (02 §Funzioni di piattaforma, NEG-T01): tabella di
// piattaforma scritta solo da app_owner (src/migrate.ts, con i valori di src/config/platform.ts), senza permessi ai
// ruoli di runtime, che la leggono con platform_config_get() (U, W). Chiavi con il punto per i valori annidati
// (`invoicing.regime`); `value` jsonb, così i numeri restano numeri e la dicitura testo (nota (1) del piano).
import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';

export const platformConfig = pgTable('platform_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});
