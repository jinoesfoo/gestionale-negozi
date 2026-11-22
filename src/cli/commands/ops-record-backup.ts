// ops:record-backup: segnaposto di FON-T06 (01 §Contenuto dell'immagine dell'app). Lo sostituisce OPS-T01b, che
// cambia solo questo file, mai l'elenco di src/cli.ts. Finché è un segnaposto termina con 64, che backup.sh riconosce
// per saltare la registrazione (08 §pgBackRest).
import { notYetAvailable, type CliCommand } from '../run';

export const command: CliCommand = {
  description: '--kind full|diff|mirror|mirror_check — registra l’esito di un backup (OPS-T01b).',
  run: notYetAvailable,
};
