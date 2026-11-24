// Colonne escluse dall'esportazione dei dati del negozio (08 §Esportazione e OPS-032; 02 NEG-014; NEG-T09, nota (5)
// del piano): i campi segreti non escono dalla piattaforma, nemmeno verso il negozio. exports.build (OPS-T08) costruisce
// con exportableColumns l'elenco del SELECT di ogni tabella che esporta, così una colonna esclusa non si legge nemmeno.
// La voce di invitations, tabella che nasce in ACC-T06, sta qui perché 08 §Esportazione elenca le due colonne in
// questo file.

/** Per ogni tabella, le colonne escluse dall'esportazione. */
export const EXPORT_EXCLUDED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  // L'hash del token d'invito: i token si salvano solo come hash (00 §4.3), e nemmeno l'hash si esporta.
  invitations: ['token_hash'],
  // Il testo cifrato dei segreti del negozio (00 R-DATI-10).
  shop_secrets: ['ciphertext'],
};

/** Le colonne esportabili di una tabella: quelle date, nello stesso ordine, senza le escluse. */
export function exportableColumns(table: string, columns: readonly string[]): string[] {
  const excluded = Object.hasOwn(EXPORT_EXCLUDED_COLUMNS, table) ? (EXPORT_EXCLUDED_COLUMNS[table] ?? []) : [];
  return columns.filter((column) => !excluded.includes(column));
}
