// ops:record-host-metrics: segnaposto di FON-T06 (01 §Contenuto dell'immagine dell'app). Lo sostituisce OPS-T04, che
// cambia solo questo file, mai l'elenco di src/cli.ts.
import { notYetAvailable, type CliCommand } from '../run';

export const command: CliCommand = {
  description: '<disk_pct> <mem_pct> — registra l’uso del disco e della memoria del server (OPS-T04).',
  run: notYetAvailable,
};
