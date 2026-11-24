// Segreti per negozio (02 §Segreti per negozio, NEG-014, 00 R-DATI-10; NEG-T09, nota (2) del piano). `ciphertext` è
// nonce di 12 byte ‖ testo cifrato ‖ tag di 16 (AES-256-GCM con SHOP_SECRETS_KEY e dati aggiuntivi autenticati
// `<shop_id>:<name>`): lo scrivono e lo leggono solo le funzioni di src/server/secrets/shop-secrets.ts, dentro withShop.
// RLS con la policy standard e i permessi (app_user: SELECT, INSERT, DELETE e UPDATE (ciphertext, rotated_at);
// app_worker: SELECT) stanno nella migrazione scritta a mano (00 §6). Nessuna colonna con `$onUpdate`: entrerebbe in
// ogni SET, fuori dal permesso per colonna.
import { sql } from 'drizzle-orm';
import { check, customType, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { shops } from './shops';

/** `bytea`: drizzle-orm 0.45.4 non ha questa colonna in pg-core (nota (9)); pg la legge e la scrive come Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const shopSecrets = pgTable(
  'shop_secrets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (table) => [
    unique('shop_secrets_shop_id_name_unique').on(table.shopId, table.name),
    check('shop_secrets_name_format_check', sql`name ~ '^[a-z0-9_.]{1,64}$'`),
    // Il nonce di 12 byte e il tag di 16 ci sono anche per un valore vuoto.
    check('shop_secrets_ciphertext_length_check', sql`octet_length(ciphertext) >= 28`),
  ],
);
