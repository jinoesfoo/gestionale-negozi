// admin:reset-2fa: segnaposto di FON-T06 (01 §Contenuto dell'immagine dell'app). Lo sostituisce ACC-T04 (area 03),
// che cambia solo questo file, mai l'elenco di src/cli.ts.
import { notYetAvailable, type CliCommand } from '../run';

export const command: CliCommand = {
  description: '<email> --reason "<motivo>" — azzera la verifica in due passaggi di un utente (ACC-T04).',
  run: notYetAvailable,
};
