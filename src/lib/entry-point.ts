// Riconosce il punto di ingresso lanciato (01 §Contenuto dell'immagine dell'app, FON-T06): src/migrate.ts,
// src/worker.ts, src/cli.ts e src/isolation-check.ts eseguono il loro programma solo quando sono il file lanciato
// (`node dist/<nome>.js`, oppure `node --import tsx src/<nome>.ts` in sviluppo), mai quando sono importati (dai test,
// o da un altro modulo).
//
// Servono due condizioni. Il file lanciato deve essere il modulo che chiede (stesso percorso reale): un altro
// programma con lo stesso nome (per esempio il cli.js di un'altra libreria) che importa src/cli.ts non lo fa partire.
// E il nome deve essere quello chiesto: nei file costruiti da tsup ogni modulo incluso ha lo stesso import.meta.url,
// quello del file costruito, quindi il percorso coincide sempre e decide il nome. Se un comando del CLI importasse
// runMigrations da src/migrate.ts, dentro dist/cli.js il controllo di migrate vedrebbe `cli`, non `migrate`, e non
// partirebbe.
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Il nome di un file senza cartella né estensione `.ts`/`.js` (anche `.mts`, `.cjs`…). */
function entryName(path: string): string {
  return basename(path).replace(/\.[cm]?[jt]s$/, '');
}

/**
 * Vero se il modulo `moduleUrl` (import.meta.url di chi chiede) è il punto di ingresso `name` ed è il file lanciato
 * da Node (process.argv[1], anche attraverso un collegamento).
 */
export function isEntryPoint(moduleUrl: string, name: string): boolean {
  const launched = process.argv[1];
  if (launched === undefined) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(moduleUrl));
    return realpathSync(launched) === modulePath && entryName(modulePath) === name;
  } catch {
    return false;
  }
}
