// Avvio dell'app (specs/01-fondamenta.md, §Variabili d'ambiente, FON-002).
// Next.js chiama register() una volta all'avvio del server: qui si valida l'ambiente dell'app e si creano le code dei
// lavori (FON-T10), non all'importazione dei moduli, così `next build` funziona senza segreti né database.
// La parte che usa le API di Node sta in instrumentation-node.ts, caricato solo nel runtime Node.js.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Durante `next build` non ci sono variabili: niente validazione né altre operazioni di avvio.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { startApp } = await import('./instrumentation-node');
  await startApp();
}
