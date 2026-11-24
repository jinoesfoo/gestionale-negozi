// Colonne escluse dall'esportazione dei dati del negozio (08 §Esportazione e OPS-032; 02 NEG-014; NEG-T09, nota (5)
// del piano): i campi segreti non escono dalla piattaforma, nemmeno verso il negozio. exports.build (OPS-T08) costruisce
// con exportableColumns l'elenco del SELECT di ogni tabella che esporta, così una colonna esclusa non si legge nemmeno.
// La voce di invitations, tabella che nasce in ACC-T06, sta qui perché 08 §Esportazione elenca le due colonne in
// questo file.

/**
 * Per ogni tabella, le colonne escluse dall'esportazione. La chiave è il nome della tabella senza schema e senza
 * virgolette, come `relname` di `pg_class`, da cui exports.build scopre le tabelle.
 */
export const EXPORT_EXCLUDED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  // L'hash del token d'invito: i token si salvano solo come hash (00 §4.3), e nemmeno l'hash si esporta.
  invitations: ['token_hash'],
  // Il testo cifrato dei segreti del negozio (00 R-DATI-10).
  shop_secrets: ['ciphertext'],
};

/** Il nome semplice del catalogo (`relname`, `attname`): niente schema, virgolette o spazi. */
const SIMPLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BAD_NAME = 'Nome di tabella o di colonna non valido per l’esportazione: serve il nome semplice del catalogo.';

const isSimpleName = (name: unknown) => typeof name === 'string' && SIMPLE_NAME.test(name);

/**
 * Le colonne esportabili di una tabella: quelle date, nello stesso ordine, senza le escluse. Tabella e colonne si
 * passano con il nome semplice del catalogo, come le chiavi di EXPORT_EXCLUDED_COLUMNS: un nome in un'altra forma
 * (`public.shop_secrets`, `"ciphertext"`) non troverebbe la sua voce e lascerebbe passare la colonna esclusa, quindi
 * si rifiuta con un errore dal messaggio fisso, che non riporta il nome (nota (5) di NEG-T09, dalla revisione).
 */
export function exportableColumns(table: string, columns: readonly string[]): string[] {
  if (!isSimpleName(table) || !columns.every(isSimpleName)) throw new Error(BAD_NAME);
  const excluded = Object.hasOwn(EXPORT_EXCLUDED_COLUMNS, table) ? (EXPORT_EXCLUDED_COLUMNS[table] ?? []) : [];
  return columns.filter((column) => !excluded.includes(column));
}
