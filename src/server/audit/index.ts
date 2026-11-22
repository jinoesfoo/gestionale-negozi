// Helper del registro delle azioni (08 §Registro, 02 NEG-013; creato in FON-T10, completato in NEG-T02, nota (3) del
// piano): inserisce una riga di audit_log nella transazione ricevuta, che è quella di withShop o di withNewShop.
// `shop_id` e `actor_user_id` non li passa chi chiama: la riga li prende dal contesto della transazione
// (public.app_shop_id() e public.app_user_id()), così non può finire su un negozio diverso dal contesto né attribuire
// l'azione a un altro utente. Fuori da un contesto `shop_id` è nullo e la policy di audit_log rifiuta l'inserimento: le
// righe di piattaforma (shop_id nullo) si scrivono solo con audit_platform(...).
import { sql } from 'drizzle-orm';
import type { PgInsertValue } from 'drizzle-orm/pg-core';
import { auditLog } from '@/server/db/schema';

export interface AuditEntry {
  /** Chi agisce: il `ctx.actor` passato a withShop. */
  actorType: 'user' | 'admin' | 'system';
  /** Per esempio `member_invited`, `module_activated`, `billing_state_changed`. */
  action: string;
  objectType?: string | null;
  objectId?: string | null;
  /** Senza segreti né hash (08 §Registro). */
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** La sola operazione di una transazione Drizzle che serve qui. */
export interface AuditTx {
  insert(table: typeof auditLog): { values(row: PgInsertValue<typeof auditLog>): PromiseLike<unknown> };
}

/** Scrive la riga nella transazione ricevuta: se la transazione si annulla, la riga sparisce con lei (OPS-020). */
export async function audit(tx: AuditTx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    shopId: sql`public.app_shop_id()`,
    actorType: entry.actorType,
    actorUserId: sql`public.app_user_id()`,
    action: entry.action,
    objectType: entry.objectType ?? null,
    objectId: entry.objectId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
