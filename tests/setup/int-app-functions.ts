// Preparazione globale del solo progetto int-app (02 NEG-T02, nota (6) del piano): crea la admin_create_shop
// provvisoria che withNewShop chiama, e la chiusura la elimina. La funzione vera nasce in ADM-T01 con la stessa firma e
// CREATE OR REPLACE: questo file non la crea mai in una migrazione, e ADM-T01 lo toglie. Sta qui, e non in un file di
// test, perché il test FON-004 legge il catalogo prima e dopo runMigrations: una funzione che comparisse o sparisse nel
// mezzo lo farebbe fallire. Vitest 5.1.0 esegue tutte le preparazioni globali prima dei test e le chiusure dopo la fine
// dei test di tutti i progetti. Gira nel processo principale di Vitest: legge .env.test.owner in un oggetto suo, senza
// toccare process.env, come tests/setup/int-queues.ts. Le esportazioni sono setup e teardown, senza export predefinito:
// con un export predefinito Vitest ignorerebbe teardown.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { Client } from 'pg';

const root = join(import.meta.dirname, '..', '..');

/** La firma definitiva di 02 §Funzioni di piattaforma. */
const SIGNATURE = 'public.admin_create_shop(text, text, text, text, text, text, text, jsonb, boolean)';
/** Il commento che la specifica chiede; CREATE OR REPLACE lo conserva, quindi non basta da solo a riconoscerla. */
const COMMENT = 'provvisoria NEG-T02';
/** Il segno nel corpo, che CREATE OR REPLACE sostituisce: la funzione vera di ADM-T01 non lo porta. */
const MARKER = '-- provvisoria NEG-T02';

// Corpo: come la funzione vera richiede l'utente del contesto (quella vera controlla is_platform_admin(app_user_id()),
// che nasce in ACC-T01): così il test prova che withNewShop imposta app.user_id prima della chiamata. Nessun controllo
// di amministratore e nessuna riga di registro (la scrive fn). Il messaggio d'errore non riporta valori.
const CREATE = `
CREATE OR REPLACE FUNCTION public.admin_create_shop(
    p_name text, p_subdomain text, p_legal_name text, p_vat_number text, p_tax_code text,
    p_sdi_code text, p_pec text, p_address jsonb, p_is_test boolean)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
${MARKER}: creata dalla preparazione dei test di integrazione (tests/setup/int-app-functions.ts),
-- mai da una migrazione; la sostituisce la versione vera di ADM-T01, con la stessa firma.
DECLARE
  v_id uuid;
BEGIN
  IF public.app_user_id() IS NULL THEN
    RAISE EXCEPTION 'admin_create_shop: manca l''utente del contesto (app.user_id).';
  END IF;
  INSERT INTO public.shops (name, subdomain, legal_name, vat_number, tax_code, sdi_code, pec, address, is_test)
  VALUES (p_name, p_subdomain, p_legal_name, p_vat_number, p_tax_code, p_sdi_code, p_pec, p_address,
          coalesce(p_is_test, false))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$`;

interface Existing {
  comment: string | null;
  source: string;
}

function ownerUrl(): string {
  const file = join(root, '.env.test.owner');
  if (!existsSync(file)) {
    throw new Error('Manca .env.test.owner: crealo copiando .env.test.owner.example (AVVIO.md, «Fuori da GitHub»).');
  }
  const url = parseEnv(readFileSync(file, 'utf8')).TEST_DATABASE_OWNER_URL;
  if (url === undefined || url === '') {
    throw new Error('Manca TEST_DATABASE_OWNER_URL in .env.test.owner: confrontalo con .env.test.owner.example.');
  }
  return url;
}

async function withOwner<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: ownerUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function existing(client: Client): Promise<Existing | undefined> {
  const result = await client.query<Existing>(
    `SELECT obj_description(p.oid, 'pg_proc') AS comment, p.prosrc AS source
       FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
    [SIGNATURE],
  );
  return result.rows[0];
}

const isProvisional = (fn: Existing) => fn.comment === COMMENT && fn.source.includes(MARKER);

export async function setup(): Promise<void> {
  await withOwner(async (client) => {
    await client.query('BEGIN');
    try {
      const found = await existing(client);
      if (found !== undefined && !isProvisional(found)) {
        // La funzione vera di ADM-T01: non si tocca.
        await client.query('ROLLBACK');
        return;
      }
      if (found !== undefined) {
        console.warn(
          'admin_create_shop provvisoria già presente: la chiusura di un test:int precedente non l’ha eliminata ' +
            '(esecuzione interrotta?). La preparazione la ricrea.',
        );
      }
      await client.query(CREATE);
      await client.query(`COMMENT ON FUNCTION ${SIGNATURE} IS '${COMMENT}'`);
      await client.query(`REVOKE EXECUTE ON FUNCTION ${SIGNATURE} FROM PUBLIC, app_worker, app_jobs`);
      await client.query(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO app_user`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

export async function teardown(): Promise<void> {
  await withOwner(async (client) => {
    const found = await existing(client);
    if (found !== undefined && isProvisional(found)) {
      await client.query(`DROP FUNCTION ${SIGNATURE}`);
    }
  });
}
