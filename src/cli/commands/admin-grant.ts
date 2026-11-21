// admin:grant: segnaposto di FON-T06 (01 §Contenuto dell'immagine dell'app). Lo sostituisce ADM-T01 (area 07), che
// cambia solo questo file, mai l'elenco di src/cli.ts.
import { notYetAvailable, type CliCommand } from '../run';

export const command: CliCommand = {
  description: '<email> — concede il ruolo di amministratore della piattaforma (ADM-T01).',
  run: notYetAvailable,
};
