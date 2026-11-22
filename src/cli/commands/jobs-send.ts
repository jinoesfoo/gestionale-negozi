// jobs:send: segnaposto di FON-T06 (01 §Contenuto dell'immagine dell'app). Lo sostituisce ADM-T03 (area 07), che
// cambia solo questo file, mai l'elenco di src/cli.ts.
import { notYetAvailable, type CliCommand } from '../run';

export const command: CliCommand = {
  description: '<coda> — accoda un lavoro nella coda indicata (ADM-T03).',
  run: notYetAvailable,
};
