// Il negozio di un host <sottodominio>.<PUBLIC_BASE_DOMAIN>, per il proxy di NEG-T04 (02 §Instradamento per host, punto
// 5; NEG-T02, nota (5) del piano). L'host si porta in minuscolo e senza porta; se non è <etichetta>.<dominio di base>, con
// una sola etichetta nel formato di NEG-001, il risultato è null senza interrogare il database; altrimenti risponde la
// funzione di piattaforma resolve_host (U). La cache in memoria sta qui, e il proxy non ne aggiunge un'altra: 60 secondi
// per un negozio trovato, 10 per un risultato vuoto, al massimo 10 000 host (quando è piena si tolgono prima le voci
// scadute, poi le più vecchie), così host inventati non fanno crescere la memoria senza limite. Un errore del database
// non entra in cache e risale al chiamante, come DbError. L'orologio predefinito è monotono e il negozio in cache è
// congelato (NEG-T02, nota (14) del ritorno al piano).
import { getPool } from './client';
import { toDbError } from './errors';

export const RESOLVE_HOST_TTL_MS = 60_000;
export const RESOLVE_HOST_NEGATIVE_TTL_MS = 10_000;
export const RESOLVE_HOST_MAX_ENTRIES = 10_000;

/** Il negozio di un host: lo stesso oggetto, congelato, per ogni chiamante finché la voce resta in cache. */
export interface ResolvedHost {
  readonly shopId: string;
  readonly subdomain: string;
  /** Lo stato del negozio (`shops.status`): anche `closed`, il 404 del sito lo decide il proxy. */
  readonly status: string;
  /** Il nome del negozio, mostrato dalla pagina segnaposto del sito pubblico. */
  readonly name: string;
}

export type HostResolver = (host: string) => Promise<ResolvedHost | null>;

export interface HostResolverOptions {
  /** Il dominio di base (PUBLIC_BASE_DOMAIN); si confronta in minuscolo. */
  baseDomain: string;
  /** La ricerca nel database di un host già controllato. */
  lookup: (host: string) => Promise<ResolvedHost | null>;
  /**
   * L'orologio, in millisecondi (00 §5: il tempo si valuta in JavaScript, e i test lo iniettano). Quello predefinito è
   * monotono: un salto all'indietro dell'ora di sistema non allunga le voci.
   */
  now?: () => number;
  /** Il massimo di host in cache (predefinito RESOLVE_HOST_MAX_ENTRIES). */
  maxEntries?: number;
}

/** Un'etichetta nel formato di NEG-001: 3–40 fra lettere minuscole, cifre e trattini, senza trattino iniziale o finale. */
const LABEL = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const PORT = /:\d+$/;

interface CacheEntry {
  value: ResolvedHost | null;
  expiresAt: number;
}

/** Il risolutore con la sua cache; la ricerca nel database e l'orologio li riceve. */
export function createHostResolver(options: HostResolverOptions): HostResolver {
  const suffix = `.${options.baseDomain.toLowerCase()}`;
  // Chiamato sull'oggetto performance: in Node 24 il metodo staccato solleva TypeError.
  const now = options.now ?? (() => performance.now());
  const maxEntries = options.maxEntries ?? RESOLVE_HOST_MAX_ENTRIES;
  // Una Map conserva l'ordine di inserimento: la prima voce è la più vecchia.
  const cache = new Map<string, CacheEntry>();

  function store(host: string, value: ResolvedHost | null, time: number): void {
    // Una voce riscritta (per esempio da due ricerche contemporanee dello stesso host) torna in fondo, fra le nuove.
    cache.delete(host);
    if (cache.size >= maxEntries) {
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= time) cache.delete(key);
      }
      for (const key of cache.keys()) {
        if (cache.size < maxEntries) break;
        cache.delete(key);
      }
    }
    const ttl = value === null ? RESOLVE_HOST_NEGATIVE_TTL_MS : RESOLVE_HOST_TTL_MS;
    cache.set(host, { value, expiresAt: time + ttl });
  }

  return async (rawHost) => {
    const host = rawHost.toLowerCase().replace(PORT, '');
    if (!host.endsWith(suffix) || !LABEL.test(host.slice(0, -suffix.length))) return null;
    const cached = cache.get(host);
    if (cached !== undefined) {
      if (cached.expiresAt > now()) return cached.value;
      cache.delete(host);
    }
    const found = await options.lookup(host);
    // Una copia congelata: chi la riceve non può cambiarla per le richieste successive.
    const value = found === null ? null : Object.freeze({ ...found });
    store(host, value, now());
    return value;
  };
}

interface ResolveHostRow {
  shop_id: string;
  subdomain: string;
  shop_status: string;
  name: string;
}

/** La ricerca del risolutore predefinito: resolve_host sul pool di DATABASE_URL, con gli errori come DbError. */
async function lookupHost(host: string): Promise<ResolvedHost | null> {
  try {
    const result = await getPool().query<ResolveHostRow>(
      'SELECT shop_id, subdomain, shop_status, name FROM public.resolve_host($1)',
      [host],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { shopId: row.shop_id, subdomain: row.subdomain, status: row.shop_status, name: row.name };
  } catch (error) {
    throw toDbError(error);
  }
}

let defaultResolver: HostResolver | undefined;

/**
 * Il negozio dell'host, oppure null. Il risolutore predefinito nasce alla prima chiamata, e solo allora legge
 * PUBLIC_BASE_DOMAIN (in minuscolo: lo schema di env.ts lo porta in minuscolo solo nella copia che valida all'avvio).
 */
export async function resolveHost(host: string): Promise<ResolvedHost | null> {
  if (defaultResolver === undefined) {
    const baseDomain = process.env.PUBLIC_BASE_DOMAIN;
    if (baseDomain === undefined || baseDomain === '') throw new Error('Manca PUBLIC_BASE_DOMAIN.');
    defaultResolver = createHostResolver({ baseDomain, lookup: lookupHost });
  }
  return defaultResolver(host);
}
