// Helper del registro delle azioni, versione minima (08 §Registro, 02 NEG-013; FON-T10): inserisce una riga di
// audit_log nella transazione ricevuta, che deve avere il contesto del negozio (app.shop_id = entry.shopId: la policy
// standard rifiuta altrimenti l'inserimento). NEG-T02 lo completa e lo prova dentro withShop. Le righe di piattaforma
// (shop_id nullo) si scrivono solo con audit_platform(...).
import { auditLog } from '@/server/db/schema';

export interface AuditEntry {
  shopId: string;
  actorType: 'user' | 'admin' | 'system';
  actorUserId?: string | null;
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
  insert(table: typeof auditLog): { values(row: typeof auditLog.$inferInsert): PromiseLike<unknown> };
}

/** Scrive la riga nella transazione ricevuta: se la transazione si annulla, la riga sparisce con lei (OPS-020). */
export async function audit(tx: AuditTx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    shopId: entry.shopId,
    actorType: entry.actorType,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    objectType: entry.objectType ?? null,
    objectId: entry.objectId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
