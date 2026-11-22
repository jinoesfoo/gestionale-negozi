// Contesto del negozio per le transazioni (02 §withShop, NEG-005; NEG-T02, note (1) e (2) del piano). Ogni chiamata
// prende una connessione dal pool, la usa per una sola transazione Drizzle e imposta il contesto con set_config(…, true),
// cioè locale alla transazione, con i valori come parametri. Alla fine, anche con errore, revoca il proxy attraverso cui
// Drizzle usa la connessione e la rilascia: un `tx` o un costruttore di query usati dopo sollevano l'errore del proxy
// revocato invece di eseguire su una connessione tornata al pool, magari già in uso con il contesto di un altro negozio.
// Le tre funzioni esportate con lo stesso nome lavorano sul pool di DATABASE_URL, preso a ogni chiamata e mai
// all'importazione; createDbContext serve ai test, con un pool di una sola connessione.
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { Pool, PoolClient } from 'pg';
import { getPool } from './client';
import { dbErrorCode, toDbError } from './errors';
import * as schema from './schema';
import type { ShopAddress } from './schema';

/** La transazione Drizzle che ricevono le funzioni passate a withShop, withUser e withNewShop. */
export type Tx = PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export interface ShopCtx {
  /** Id del negozio, con la forma di un UUID (controllata prima di prendere una connessione). */
  shopId: string;
  /** Utente che agisce; null per i lavori di sistema (app.user_id resta vuoto). */
  userId: string | null;
  /** Chi agisce: è l'`actorType` che chi chiama passa ad audit(). */
  actor: 'user' | 'admin' | 'system';
  /** Transazione in sola lettura (`begin read only`). */
  readOnly?: boolean;
}

/** I dati del negozio da creare, nell'ordine della firma di admin_create_shop (02 §Funzioni di piattaforma). */
export interface NewShopInput {
  name: string;
  subdomain: string;
  legalName?: string | null;
  vatNumber?: string | null;
  taxCode?: string | null;
  sdiCode?: string | null;
  pec?: string | null;
  address?: ShopAddress | null;
  isTest?: boolean;
}

export interface DbContext {
  /** Apre una transazione con il contesto del negozio `ctx.shopId` e dell'utente `ctx.userId`. */
  withShop<T>(ctx: ShopCtx, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Apre una transazione con il solo utente (app.shop_id vuoto): serve a leggere le proprie membership. */
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * In una sola transazione: imposta l'amministratore, crea il negozio con admin_create_shop, ne apre il contesto e
   * chiama `fn` con il suo id; se `fn` fallisce si annullano insieme il negozio e quello che `fn` ha scritto.
   */
  withNewShop<T>(input: NewShopInput, adminId: string, fn: (tx: Tx, shopId: string) => Promise<T>): Promise<T>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gli argomenti si controllano prima di prendere una connessione; i messaggi non riportano i valori. */
function requireUuid(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(message);
}

function requireText(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value === '') throw new Error(message);
}

/**
 * Vero se la connessione non può tornare al pool: è fallito il rollback (la transazione potrebbe essere ancora aperta,
 * con il contesto di un negozio) oppure l'errore viene dalla connessione stessa, senza codice SQLSTATE (connessione
 * persa, tempo scaduto; anche il `begin` fallito, che in drizzle-orm 0.45.4 sta fuori dal `try` della transazione).
 */
function connectionUnusable(error: unknown): boolean {
  return error instanceof DrizzleQueryError && (error.query === 'rollback' || dbErrorCode(error) === undefined);
}

/** withShop, withUser e withNewShop sul pool ricevuto. */
export function createDbContext(pool: Pool): DbContext {
  async function transaction<T>(readOnly: boolean, body: (tx: Tx) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      throw toDbError(error);
    }
    const { proxy, revoke } = Proxy.revocable(client, {});
    // Mentre la connessione è fuori dal pool, pg-pool non ne ascolta gli errori: una connessione che cade fra due
    // istruzioni emetterebbe 'error' senza ascoltatori e terminerebbe il processo.
    let lost = false;
    const onError = () => {
      lost = true;
    };
    client.on('error', onError);
    let unusable = false;
    try {
      return await drizzle({ client: proxy, schema }).transaction(
        body,
        readOnly ? { accessMode: 'read only' } : undefined,
      );
    } catch (error) {
      unusable = connectionUnusable(error);
      throw toDbError(error);
    } finally {
      client.off('error', onError);
      revoke();
      // Con un errore la connessione si distrugge invece di tornare al pool (pg-pool, release(err)).
      client.release(unusable || lost ? new Error('Connessione scartata dopo un errore.') : undefined);
    }
  }

  return {
    async withShop(ctx, fn) {
      requireUuid(ctx.shopId, 'withShop: shopId non ha la forma di un UUID.');
      const { shopId } = ctx;
      const userId = ctx.userId ?? '';
      return transaction(ctx.readOnly === true, async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.shop_id', ${shopId}, true), set_config('app.user_id', ${userId}, true)`,
        );
        return fn(tx);
      });
    },

    async withUser(userId, fn) {
      requireText(userId, 'withUser: manca userId.');
      return transaction(false, async (tx) => {
        // Il negozio si svuota (non si imposta): difesa in più se la connessione portasse un contesto rimasto.
        await tx.execute(
          sql`SELECT set_config('app.shop_id', ${''}, true), set_config('app.user_id', ${userId}, true)`,
        );
        return fn(tx);
      });
    },

    async withNewShop(input, adminId, fn) {
      requireText(adminId, 'withNewShop: manca adminId.');
      const address = input.address === undefined || input.address === null ? null : JSON.stringify(input.address);
      return transaction(false, async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.shop_id', ${''}, true), set_config('app.user_id', ${adminId}, true)`,
        );
        const created = await tx.execute<{ id: string }>(
          sql`SELECT public.admin_create_shop(${input.name}::text, ${input.subdomain}::text,
                ${input.legalName ?? null}::text, ${input.vatNumber ?? null}::text, ${input.taxCode ?? null}::text,
                ${input.sdiCode ?? null}::text, ${input.pec ?? null}::text, ${address}::jsonb,
                ${input.isTest ?? false}::boolean) AS id`,
        );
        const shopId = created.rows[0]?.id;
        if (typeof shopId !== 'string') throw new Error('withNewShop: admin_create_shop non ha restituito il negozio.');
        await tx.execute(sql`SELECT set_config('app.shop_id', ${shopId}, true)`);
        return fn(tx, shopId);
      });
    },
  };
}

/** withShop sul pool di DATABASE_URL (preso alla chiamata, non all'importazione). */
export async function withShop<T>(ctx: ShopCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return createDbContext(getPool()).withShop(ctx, fn);
}

/** withUser sul pool di DATABASE_URL. */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return createDbContext(getPool()).withUser(userId, fn);
}

/** withNewShop sul pool di DATABASE_URL. */
export async function withNewShop<T>(
  input: NewShopInput,
  adminId: string,
  fn: (tx: Tx, shopId: string) => Promise<T>,
): Promise<T> {
  return createDbContext(getPool()).withNewShop(input, adminId, fn);
}
