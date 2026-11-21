// Registro delle azioni (08 §Registro, 02 NEG-013; creato in FON-T10). `shop_id` nullo = azione di piattaforma, scritta
// solo con audit_platform(...); la chiave esterna verso shops la aggiunge NEG-T01. RLS abilitata e forzata con la
// policy standard, e i permessi (app_user e app_worker: solo SELECT, INSERT), stanno nella migrazione scritta a mano
// (00 §6: le parti che Drizzle non esprime). `actor_user_id` è testo senza chiave esterna: conserva l'id storico.
import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id'),
    actorType: text('actor_type').notNull(),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    objectType: text('object_type'),
    objectId: text('object_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('audit_log_actor_type_check', sql`actor_type IN ('user', 'admin', 'system')`),
    index('audit_log_shop_created_idx').on(table.shopId, table.createdAt),
  ],
);
