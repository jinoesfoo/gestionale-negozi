// Contesto del negozio per le transazioni (02 §withShop, NEG-005; NEG-T02, note (1) e (2) del piano). Ogni chiamata
// prende una connessione dal pool, la usa per una sola transazione Drizzle e imposta il contesto con set_config(…, true),
// cioè locale alla transazione, con i valori come parametri. Alla fine, anche con errore, revoca il proxy attraverso cui
// Drizzle usa la connessione e la rilascia: un `tx` o un costruttore di query usati dopo sollevano l'errore del proxy
// revocato invece di eseguire su una connessione tornata al pool, magari già in uso con il contesto di un altro negozio.
// Le tre funzioni esportate con lo stesso nome lavorano sul pool di DATABASE_URL, preso a ogni chiamata e mai
// all'importazione; createDbContext serve ai test, con un pool di una sola connessione. Dal ritorno al piano (nota (10)):
// una chiamata dentro fn di un'altra si rifiuta, una connessione che esce dal pool non inattiva si scarta, e un commit
// che PostgreSQL ha trasformato in rollback fa fallire la chiamata.
import { AsyncLocalStorage } from 'node:async_hooks';
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
  /** Id del negozio: un UUID in minuscolo, come lo restituisce PostgreSQL (controllato prima di prendere una connessione). */
  shopId: string;
  /** Utente che agisce, stringa non vuota; null per i lavori di sistema (app.user_id resta vuoto). */
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

/** Un UUID in minuscolo (qualunque versione): così `ctx.shopId` coincide, come stringa, con gli id letti dal database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Il segno della transazione aperta, unico per il modulo e non per il contesto (le funzioni esportate creano un contesto
 * nuovo a ogni chiamata): vale `open: true` finché la transazione è aperta, così una chiamata avviata dentro fn ma
 * eseguita dopo la sua fine (da un timer, da una promessa non attesa) è ammessa.
 */
const openTransaction = new AsyncLocalStorage<{ open: boolean }>();

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

/** Vero per la configurazione della query con cui drizzle-orm 0.45.4 chiude la transazione (`sql\`commit\``). */
function isCommit(config: unknown): boolean {
  if (typeof config === 'string') return config === 'commit';
  return typeof config === 'object' && config !== null && (config as { text?: unknown }).text === 'commit';
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

/** Il tag di PostgreSQL di un risultato di pg (`COMMIT`, `ROLLBACK`, …), se c'è. */
function commandOf(result: unknown): unknown {
  return typeof result === 'object' && result !== null ? (result as { command?: unknown }).command : undefined;
}

/** withShop, withUser e withNewShop sul pool ricevuto. */
export function createDbContext(pool: Pool): DbContext {
  async function transaction<T>(readOnly: boolean, body: (tx: Tx) => Promise<T>): Promise<T> {
    // Nota (10)(b): una chiamata dentro fn di un'altra aprirebbe una transazione indipendente su una seconda
    // connessione (scritture non viste, stallo senza limite, pool esaurito): si rifiuta prima di prendere la connessione.
    if (openTransaction.getStore()?.open === true) {
      throw new Error(
        'withShop, withUser e withNewShop non si chiamano dentro fn di un’altra: dentro fn si usa il tx.',
      );
    }
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      throw toDbError(error);
    }
    // Nota (10)(d): una connessione rilasciata da altro codice a metà di una transazione ('T') o in una transazione
    // fallita ('E') non si usa: withShop ne proseguirebbe la transazione, o fallirebbe sul begin a ogni chiamata.
    if (client.getTransactionStatus() !== 'I') {
      client.release(new Error('Connessione scartata: non era inattiva.'));
      throw new Error('La connessione presa dal pool non era inattiva ed è stata scartata.');
    }
    // Nota (10)(a): drizzle-orm 0.45.4 ignora il risultato del commit. Se fn ha intercettato un errore senza savepoint,
    // la transazione è fallita e PostgreSQL risponde al commit con il tag ROLLBACK: il proxy legge quel tag.
    let rolledBack = false;
    const { proxy, revoke } = Proxy.revocable(client, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (property !== 'query' || typeof value !== 'function') return value;
        return function query(this: unknown, ...args: unknown[]): unknown {
          const result: unknown = Reflect.apply(value, this, args);
          if (!isCommit(args[0]) || !isThenable(result)) return result;
          return Promise.resolve(result).then((outcome) => {
            if (commandOf(outcome) === 'ROLLBACK') rolledBack = true;
            return outcome;
          });
        };
      },
    });
    // Mentre la connessione è fuori dal pool, pg-pool non ne ascolta gli errori: una connessione che cade fra due
    // istruzioni emetterebbe 'error' senza ascoltatori e terminerebbe il processo.
    let lost = false;
    const onError = () => {
      lost = true;
    };
    client.on('error', onError);
    const marker = { open: true };
    let unusable = false;
    try {
      const result = await openTransaction.run(marker, () =>
        drizzle({ client: proxy, schema }).transaction(body, readOnly ? { accessMode: 'read only' } : undefined),
      );
      if (rolledBack) {
        throw new Error(
          'La transazione è fallita dentro fn e PostgreSQL l’ha annullata al commit: nulla è stato salvato.',
        );
      }
      return result;
    } catch (error) {
      unusable = connectionUnusable(error);
      throw toDbError(error);
    } finally {
      marker.open = false;
      client.off('error', onError);
      revoke();
      // Con un errore la connessione si distrugge invece di tornare al pool (pg-pool, release(err)).
      client.release(unusable || lost ? new Error('Connessione scartata dopo un errore.') : undefined);
    }
  }

  return {
    async withShop(ctx, fn) {
      requireUuid(ctx.shopId, 'withShop: shopId non ha la forma di un UUID in minuscolo.');
      // userId è null (lavoro di sistema) o una stringa non vuota: '' o un valore mancante farebbero passare l'azione
      // di un utente per un lavoro di sistema (nota (10)(c)).
      if (ctx.userId !== null) requireText(ctx.userId, 'withShop: userId deve essere null o una stringa non vuota.');
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
