// billing:test-clock-customer: segnaposto di FON-T06 (01 §Contenuto dell'immagine dell'app). Lo sostituisce BIL-T07,
// che cambia solo questo file, mai l'elenco di src/cli.ts.
import { notYetAvailable, type CliCommand } from '../run';

export const command: CliCommand = {
  description: 'crea un cliente Stripe con un orologio di prova (BIL-T07; solo con STRIPE_TEST_CLOCK_SETUP=true).',
  run: notYetAvailable,
};
