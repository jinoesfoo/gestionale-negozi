// Indirizzi esclusi dagli invii (FON-011, 01 FON-T10): tabella di piattaforma, senza shop_id. `email` è la chiave
// primaria, in minuscolo, ed è l'unico indice unico: il webhook inserisce con ON CONFLICT DO NOTHING senza nominare la
// colonna (app_user ha solo INSERT), quindi un altro indice unico farebbe ignorare in silenzio i suoi conflitti.
// Permessi (app_user: INSERT; app_worker: SELECT) nella migrazione scritta a mano.
import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    email: text('email').primaryKey(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('email_suppressions_email_lower_check', sql`email = lower(email)`),
    check('email_suppressions_reason_check', sql`reason IN ('bounce', 'complaint')`),
  ],
);
