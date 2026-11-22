// Controllo di separazione fra negozi in produzione (collaudo C12): segnaposto di FON-T06 e FON-T07b, che serve alla
// build dell'immagine (01 §Contenuto dell'immagine dell'app: tsup costruisce dist/isolation-check.js). Lo sostituisce
// BIL-T09. Termina con «non ancora disponibile» e codice 1: un controllo che non controlla nulla non deve riuscire.
import { isEntryPoint } from './lib/entry-point';

if (isEntryPoint(import.meta.url, 'isolation-check')) {
  console.error('isolation-check: non ancora disponibile.');
  process.exit(1);
}
