// stripe:seed: segnaposto di FON-T06 (01 §Contenuto dell'immagine dell'app). Lo sostituisce BIL-T01, che cambia solo
// questo file, mai l'elenco di src/cli.ts.
import { notYetAvailable, type CliCommand } from '../run';

export const command: CliCommand = {
  description: '[--live] — crea in Stripe listino e configurazione del portale clienti (BIL-T01).',
  run: notYetAvailable,
};
