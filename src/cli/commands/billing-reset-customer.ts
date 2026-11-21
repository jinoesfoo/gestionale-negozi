// billing:reset-customer: segnaposto di FON-T06 (01 §Contenuto dell'immagine dell'app). Lo sostituisce BIL-T07, che
// cambia solo questo file, mai l'elenco di src/cli.ts.
import { notYetAvailable, type CliCommand } from '../run';

export const command: CliCommand = {
  description: '<shopId> [--live] — riparte da zero con il cliente Stripe di un negozio (BIL-T07).',
  run: notYetAvailable,
};
