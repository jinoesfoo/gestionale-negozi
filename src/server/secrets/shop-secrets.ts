// Segreti per negozio (02 §Segreti per negozio, NEG-014; 00 R-DATI-10; NEG-T09, nota (4) del piano). Le credenziali di
// un negozio verso fornitori esterni stanno solo in shop_secrets, cifrate qui, in Node, con AES-256-GCM e
// SHOP_SECRETS_KEY: il valore in chiaro non è mai un parametro SQL (i parametri finirebbero nel messaggio di
// DrizzleQueryError, nei log e in Sentry) né il testo di un errore. Il valore salvato è nonce di 12 byte ‖ testo cifrato
// ‖ tag di 16, con dati aggiuntivi autenticati i byte UTF-8 di `<shop_id>:<name>`, con shop_id nella forma minuscola
// che withShop impone a ctx.shopId, uguale a shop_id::text: un testo cifrato copiato su un'altra riga non si decifra.
// Ogni funzione apre da sé withShop (getShopSecret in sola lettura), quindi non si chiama dentro fn di un'altra
// withShop (context.ts lo rifiuta): chi la usa la chiama prima o dopo la propria transazione, e un lavoro chiama il
// fornitore esterno fuori da ogni transazione (05). Cifratura e decifratura restano interne al file: un segreto si
// legge solo con getShopSecret.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { audit } from '@/server/audit';
import { type DbContext, type ShopCtx, withShop } from '@/server/db/context';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** Il formato del nome, lo stesso del vincolo shop_secrets_name_format_check (02 §Segreti per negozio). */
const NAME = /^[a-z0-9_.]{1,64}$/;

// I messaggi sono fissi: non riportano mai il valore, il nome o la chiave ricevuti (00 §4.2, NEG-014).
const MISSING_KEY = 'Manca SHOP_SECRETS_KEY.';
const INVALID_KEY = 'SHOP_SECRETS_KEY non valida: servono 32 byte in base64.';
const BAD_NAME = 'Nome del segreto non valido.';
const BAD_VALUE = 'Il valore del segreto deve essere una stringa.';
const BAD_FORMAT = 'Segreto del negozio in un formato sconosciuto.';
const AUTH_FAILED =
  'Segreto del negozio non decifrabile: chiave diversa, altro negozio o altro nome, oppure testo alterato.';

export interface ShopSecretsOptions {
  /** La withShop con cui aprire le transazioni: nei test, quella di createDbContext su un pool dato. */
  withShop: DbContext['withShop'];
  /** Chiave di 32 byte in base64, solo per i test; senza, si legge SHOP_SECRETS_KEY a ogni chiamata. */
  key?: string;
}

export interface ShopSecrets {
  /** Il segreto `name` del negozio del contesto, oppure null se non c'è; un errore se c'è ma non si decifra. */
  getShopSecret(ctx: ShopCtx, name: string): Promise<string | null>;
  /** Scrive il segreto (o lo sostituisce, impostando rotated_at) e lo registra con il solo nome. */
  setShopSecret(ctx: ShopCtx, name: string, value: string): Promise<void>;
  /** Cancella il segreto e lo registra con il solo nome; false se non c'era (e allora non scrive nel registro). */
  deleteShopSecret(ctx: ShopCtx, name: string): Promise<boolean>;
}

/** La chiave: quella data, oppure SHOP_SECRETS_KEY dell'ambiente letta adesso. Gli errori nominano la variabile. */
function resolveKey(keyBase64: string | undefined): Buffer {
  const value = keyBase64 ?? process.env.SHOP_SECRETS_KEY;
  if (value === undefined || value === '') throw new Error(MISSING_KEY);
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) throw new Error(INVALID_KEY);
  return key;
}

function requireName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error(BAD_NAME);
}

/** I dati aggiuntivi autenticati: legano il testo cifrato al negozio e al nome della sua riga. */
const associatedData = (shopId: string, name: string) => Buffer.from(`${shopId}:${name}`, 'utf8');

function encrypt(key: Buffer, shopId: string, name: string, value: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(associatedData(shopId, name));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

function decrypt(key: Buffer, shopId: string, name: string, stored: unknown): string {
  if (!Buffer.isBuffer(stored) || stored.length < NONCE_BYTES + TAG_BYTES) throw new Error(BAD_FORMAT);
  const nonce = stored.subarray(0, NONCE_BYTES);
  const body = stored.subarray(NONCE_BYTES, stored.length - TAG_BYTES);
  // Gli ultimi 16 byte sono sempre il tag; authTagLength rifiuta comunque un tag più corto (Node 24, DEP0182).
  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(associatedData(shopId, name));
  decipher.setAuthTag(stored.subarray(stored.length - TAG_BYTES));
  try {
    // update() restituisce il testo prima dell'autenticazione: lo si usa solo se final() la conferma.
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(AUTH_FAILED);
  }
}

/** Le tre funzioni su una withShop e una chiave date: le usano i test; il codice usa le funzioni esportate qui sotto. */
export function createShopSecrets(options: ShopSecretsOptions): ShopSecrets {
  return {
    async getShopSecret(ctx, name) {
      requireName(name);
      const key = resolveKey(options.key);
      const stored = await options.withShop({ ...ctx, readOnly: true }, async (tx) => {
        const result = await tx.execute<{ ciphertext: unknown }>(
          sql`SELECT ciphertext FROM public.shop_secrets WHERE shop_id = ${ctx.shopId}::uuid AND name = ${name}`,
        );
        return result.rows[0]?.ciphertext;
      });
      if (stored === undefined) return null;
      return decrypt(key, ctx.shopId, name, stored);
    },

    async setShopSecret(ctx, name, value) {
      requireName(name);
      if (typeof value !== 'string') throw new Error(BAD_VALUE);
      const ciphertext = encrypt(resolveKey(options.key), ctx.shopId, name, value);
      await options.withShop(ctx, async (tx) => {
        // Solo le due colonne del permesso per colonna di app_user (00 §6); rotated_at è nullo solo per una riga
        // appena inserita.
        const result = await tx.execute<{ rotated: boolean }>(
          sql`INSERT INTO public.shop_secrets (shop_id, name, ciphertext)
              VALUES (${ctx.shopId}::uuid, ${name}, ${ciphertext}::bytea)
              ON CONFLICT (shop_id, name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, rotated_at = now()
              RETURNING (rotated_at IS NOT NULL) AS rotated`,
        );
        const rotated = result.rows[0]?.rotated === true;
        await audit(tx, {
          actorType: ctx.actor,
          action: rotated ? 'shop_secret_rotated' : 'shop_secret_set',
          objectType: 'shop_secret',
          objectId: name,
        });
      });
    },

    async deleteShopSecret(ctx, name) {
      requireName(name);
      return options.withShop(ctx, async (tx) => {
        const result = await tx.execute<{ id: string }>(
          sql`DELETE FROM public.shop_secrets WHERE shop_id = ${ctx.shopId}::uuid AND name = ${name} RETURNING id`,
        );
        if (result.rows.length === 0) return false;
        await audit(tx, {
          actorType: ctx.actor,
          action: 'shop_secret_deleted',
          objectType: 'shop_secret',
          objectId: name,
        });
        return true;
      });
    },
  };
}

/** Il segreto `name` del negozio del contesto, oppure null se non c'è (02 §Segreti per negozio). */
export function getShopSecret(ctx: ShopCtx, name: string): Promise<string | null> {
  return createShopSecrets({ withShop }).getShopSecret(ctx, name);
}

/** Scrive o sostituisce il segreto `name` del negozio del contesto, con la riga di registro (02 §Segreti per negozio). */
export function setShopSecret(ctx: ShopCtx, name: string, value: string): Promise<void> {
  return createShopSecrets({ withShop }).setShopSecret(ctx, name, value);
}

/** Cancella il segreto `name` del negozio del contesto; true se c'era (02 §Segreti per negozio). */
export function deleteShopSecret(ctx: ShopCtx, name: string): Promise<boolean> {
  return createShopSecrets({ withShop }).deleteShopSecret(ctx, name);
}
