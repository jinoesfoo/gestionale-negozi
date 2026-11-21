// Email di prova di DOM-012 (nota (3) del piano di FON-T10, lista di controllo docs/verifiche/fon-t10.md):
//
//   pnpm email:prova <destinatario> <mittente>
//
// invia con il nostro adattatore Brevo il modello `prova`, dal mittente indicato (uno su {{DOMINIO}} e uno su
// {{DOMINIO_TEST}}), con le variabili di .env.worker: così l'adattatore si prova contro Brevo su joo. La lancia
// l'utente dal suo terminale, con la chiave vera ed EMAIL_PROVIDER=brevo (con `fake` non invierebbe nulla: si ferma e
// lo dice). Codici di uscita: 0 inviata, 1 ambiente o invio non riuscito, 2 argomenti mancanti. Non scrive mai la chiave.
import { EnvError, parseWorkerEnv } from '@/config/env';
import { platform } from '@/config/platform';
import { isEntryPoint } from '@/lib/entry-point';
import { errorMessage } from '@/lib/errors';
import { BrevoEmailSender } from './brevo';
import { renderEmail } from './templates';

const USAGE = [
  'Uso: pnpm email:prova <destinatario> <mittente>',
  '  destinatario: una tua casella, dove leggere le intestazioni (Authentication-Results);',
  '  mittente: un mittente creato su Brevo, su foondaco.com oppure su foondaco.it.',
  '  .env.worker deve avere EMAIL_PROVIDER=brevo e la chiave vera in EMAIL_API_KEY.',
].join('\n');

const isAddress = (value: string | undefined): value is string =>
  value !== undefined && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function runEmailProbe(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  options: { fetch?: typeof fetch } = {},
): Promise<number> {
  const [to, from] = argv;
  if (!isAddress(to) || !isAddress(from)) {
    console.error(USAGE);
    return 2;
  }
  let apiKey: string;
  try {
    const parsed = parseWorkerEnv(env);
    if (parsed.EMAIL_PROVIDER !== 'brevo') {
      console.error(
        'Email di prova non inviata: in .env.worker serve EMAIL_PROVIDER=brevo (con fake non parte nulla).',
      );
      return 1;
    }
    apiKey = parsed.EMAIL_API_KEY;
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    console.error(`Email di prova non inviata. ${error.message}`);
    return 1;
  }

  const sender = new BrevoEmailSender({
    apiKey,
    from,
    fromName: platform.productName,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  try {
    const result = await sender.send({ to, ...renderEmail('prova', { data: {} }) });
    console.log(`Email di prova inviata da ${from} (id del messaggio di Brevo: ${result.id ?? 'non indicato'}).`);
    return 0;
  } catch (error) {
    console.error(`Email di prova non inviata: ${errorMessage(error)}`);
    return 1;
  }
}

if (isEntryPoint(import.meta.url, 'probe')) {
  process.exit(await runEmailProbe(process.argv.slice(2), process.env));
}
