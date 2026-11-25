// Fixture inerti dei test di separazione (02 NEG-T05, nota (2) del piano; NEG-004): le usano i test di
// tests/integration/app/ e isolation-check (BIL-T09), così test e controllo in produzione scrivono gli stessi dati.
// Si scrivono con il ruolo proprietario, che chi chiama passa come parametro: questo file non importa nessun client né
// pg (00 R-DATI-3). Sono inerti: negozio trial appena creato, nessun id Stripe, nessun lavoro in coda.
// Ogni compito che crea una tabella con shop_id aggiunge qui la sua fixture: il test di separazione fallisce per una
// tabella con shop_id senza fixture.

/** Il client del proprietario, come tipo strutturale: Pool e PoolClient di pg lo soddisfano. */
export interface OwnerClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Un negozio creato dalle fixture, con l'utente che ne usa il contesto. */
export interface FixtureShop {
  readonly id: string;
  readonly subdomain: string;
  readonly userId: string;
}

export interface FixtureShopOptions {
  /** Il sottodominio, valido per NEG-001: i test usano negozio-a e negozio-b, isolation-check sottodomini suoi. */
  subdomain: string;
  name: string;
  /** L'utente del negozio (un testo, finché ACC-T01 non crea gli utenti veri); diverso per ogni negozio. */
  userId: string;
  /** I negozi di isolation-check sono negozi di collaudo (is_test). */
  isTest?: boolean;
  /** I negozi di isolation-check hanno purge_requested_at, così i lavori pianificati li escludono. */
  purgeRequested?: boolean;
}

/** Crea la riga di shops: stato trial, nessun dato fiscale, nessun id Stripe. */
export async function createFixtureShop(owner: OwnerClient, options: FixtureShopOptions): Promise<FixtureShop> {
  const result = await owner.query(
    `INSERT INTO public.shops (name, subdomain, status, is_test, purge_requested_at)
     VALUES ($1, $2, 'trial', $3::boolean, CASE WHEN $4::boolean THEN now() END)
     RETURNING id::text AS id`,
    [options.name, options.subdomain, options.isTest ?? false, options.purgeRequested ?? false],
  );
  const [row] = result.rows as { id?: unknown }[];
  if (typeof row?.id !== 'string') throw new Error('createFixtureShop: la riga di shops non è stata creata.');
  return { id: row.id, subdomain: options.subdomain, userId: options.userId };
}

/** Scrive i dati del negozio in una tabella con shop_id. */
export type ShopDataFixture = (owner: OwnerClient, shop: FixtureShop) => Promise<void>;

/** Una fixture per ogni tabella con shop_id diversa da shops, per nome della tabella. */
export const SHOP_DATA_FIXTURES: Readonly<Record<string, ShopDataFixture>> = {
  audit_log: async (owner, shop) => {
    await owner.query(
      `INSERT INTO public.audit_log (shop_id, actor_type, actor_user_id, action, object_type)
       VALUES ($1::uuid, 'user', $2, 'fixture_isolation', 'fixture')`,
      [shop.id, shop.userId],
    );
  },
  // NEG-T09, nota (3): 28 byte a zero, inerti e non cifrati. isolation-check usa questa fixture nel servizio migrate,
  // che non ha SHOP_SECRETS_KEY, e nessun codice li decifra; 28 byte rispettano il vincolo sulla lunghezza minima.
  shop_secrets: async (owner, shop) => {
    await owner.query(
      `INSERT INTO public.shop_secrets (shop_id, name, ciphertext)
       VALUES ($1::uuid, 'fixture_isolation', decode(repeat('00', 28), 'hex'))`,
      [shop.id],
    );
  },
};
