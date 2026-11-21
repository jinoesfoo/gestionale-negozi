/** Il messaggio di un errore qualsiasi, per i log (chi lo scrive si assicura che non porti valori o dati personali). */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
