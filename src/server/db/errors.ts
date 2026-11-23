// Errori del database senza valori (00 §4.2; 02 NEG-T02, nota (2) del piano). Il DrizzleQueryError di drizzle-orm mette
// nel messaggio il testo della query e i parametri (dati personali) e l'errore di PostgreSQL in `cause`; l'errore di pg
// porta anche `detail`, `hint`, `where` e `internalQuery`, che possono contenere valori. Il filtro beforeSend di Sentry
// (08) toglie solo email e sequenze di 4–6 cifre: quello che esce da withShop, withUser, withNewShop e resolveHost è un
// DbError con il solo codice SQLSTATE, i nomi di vincolo, tabella, colonna e schema e un messaggio senza valori. Chi
// chiama riconosce un errore del database da `code` e `constraint`, mai dal messaggio.
import { DrizzleQueryError } from 'drizzle-orm/errors';

/** Codice SQLSTATE: cinque cifre o lettere maiuscole. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Classi e codici il cui messaggio di PostgreSQL contiene solo nomi, mai valori: 23 (vincoli: il valore sta in
 * `detail`), 42 (comprende il permesso mancante e il rifiuto della policy), sola lettura, serializzazione, stallo,
 * tempo scaduto e i RAISE delle funzioni del progetto (P0001), che non riportano valori.
 */
const NAME_ONLY_CLASSES = ['23', '42'];
const NAME_ONLY_CODES: ReadonlySet<string> = new Set(['25006', '40001', '40P01', '57014', 'P0001']);
/**
 * Eccezioni nelle classi qui sopra: 42601 (errore di sintassi), perché to_tsquery e il parser di jsonpath citano nel
 * messaggio il testo ricevuto come parametro (NEG-T02, nota (13)).
 */
const GENERIC_CODES: ReadonlySet<string> = new Set(['42601']);

/** I campi dell'errore di pg (DatabaseError di pg-protocol) che servono qui. */
interface PgError extends Error {
  code: string;
  severity: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
}

/**
 * Un errore restituito da PostgreSQL: codice SQLSTATE e `severity`, che pg copia sempre dalla risposta del server. Gli
 * errori di sistema della connessione (ECONNRESET, EPIPE) hanno un codice ma non `severity`.
 */
function isPgError(error: unknown): error is PgError {
  if (!(error instanceof Error)) return false;
  const { code, severity } = error as Partial<PgError>;
  return typeof code === 'string' && SQLSTATE.test(code) && typeof severity === 'string';
}

function hasNameOnlyMessage(code: string): boolean {
  if (GENERIC_CODES.has(code)) return false;
  return NAME_ONLY_CLASSES.includes(code.slice(0, 2)) || NAME_ONLY_CODES.has(code);
}

/** Errore del database con il solo codice, i nomi e un messaggio senza valori; mai `cause`. */
export class DbError extends Error {
  static {
    this.prototype.name = 'DbError';
  }

  /** Codice SQLSTATE (per esempio `23505`). */
  readonly code: string;
  readonly constraint: string | undefined;
  readonly table: string | undefined;
  readonly column: string | undefined;
  readonly schema: string | undefined;

  constructor(error: PgError) {
    super(hasNameOnlyMessage(error.code) ? error.message : `Errore del database (codice ${error.code}).`);
    this.code = error.code;
    this.constraint = error.constraint;
    this.table = error.table;
    this.column = error.column;
    this.schema = error.schema;
  }
}

/**
 * L'errore da far uscire dalle funzioni del database: un errore di PostgreSQL, anche avvolto da Drizzle, diventa un
 * DbError; un DrizzleQueryError senza codice SQLSTATE (connessione persa, tempo scaduto, proxy revocato) diventa
 * l'errore avvolto, il cui messaggio non contiene la query né i parametri; ogni altro valore passa invariato.
 */
export function toDbError(error: unknown): unknown {
  if (error instanceof DbError) return error;
  if (error instanceof DrizzleQueryError) {
    const { cause } = error;
    if (isPgError(cause)) return new DbError(cause);
    return cause instanceof Error ? cause : new Error('Errore del database senza codice SQLSTATE.');
  }
  if (isPgError(error)) return new DbError(error);
  return error;
}

/**
 * Il codice SQLSTATE di un DbError, di un errore di pg o di un DrizzleQueryError (per esempio dentro `fn`, dopo un
 * savepoint); undefined per ogni altro errore.
 */
export function dbErrorCode(error: unknown): string | undefined {
  if (error instanceof DbError) return error.code;
  const target = error instanceof DrizzleQueryError ? error.cause : error;
  return isPgError(target) ? target.code : undefined;
}
