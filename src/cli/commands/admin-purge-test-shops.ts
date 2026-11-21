// admin:purge-test-shops: segnaposto di FON-T06 (01 §Contenuto dell'immagine dell'app). Lo sostituisce BIL-T09, che
// cambia solo questo file, mai l'elenco di src/cli.ts.
import { notYetAvailable, type CliCommand } from '../run';

export const command: CliCommand = {
  description: '[--ids <id,…>] — cancella i negozi di prova (BIL-T09).',
  run: notYetAvailable,
};
