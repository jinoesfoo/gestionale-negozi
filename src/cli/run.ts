// Esecuzione del CLI (01 §Contenuto dell'immagine dell'app, FON-002, FON-T06). `--help`, o nessun argomento, stampa
// l'elenco dei comandi ed esce con 0 senza leggere l'ambiente; ogni altro comando, anche uno non ancora scritto o
// sconosciuto, valida prima lo schema del CLI (DATABASE_OWNER_URL, come app_owner). Codici di uscita: 0 elenco,
// 1 ambiente non valido o errore del comando, 2 comando sconosciuto, 64 solo per un comando non ancora scritto
// (notYetAvailable: backup.sh lo riconosce per saltare la registrazione, 08 §pgBackRest), altrimenti quello del comando.
import { EnvError, parseCliEnv, type CliEnv } from '@/config/env';

/** Le uscite del CLI: righe sullo standard output e sullo standard error. */
export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Ciò che riceve un comando: il proprio nome, gli argomenti dopo il nome, l'ambiente già validato, le uscite. */
export interface CliCommandContext {
  name: string;
  args: string[];
  env: CliEnv;
  io: CliIo;
}

/** Un comando del CLI: una riga per l'elenco (argomenti e scopo) e la funzione che restituisce il codice di uscita. */
export interface CliCommand {
  description: string;
  run: (context: CliCommandContext) => number | Promise<number>;
}

export type CliCommands = Readonly<Record<string, CliCommand>>;

/** Codice di uscita riservato ai comandi non ancora scritti («non ancora disponibile»). */
export const NOT_YET_AVAILABLE_EXIT_CODE = 64;
const FAILURE_EXIT_CODE = 1;
const UNKNOWN_COMMAND_EXIT_CODE = 2;

/** La funzione comune dei segnaposto in src/cli/commands/: il comando non è ancora scritto. */
export function notYetAvailable(context: CliCommandContext): number {
  context.io.err(`${context.name}: non ancora disponibile.`);
  return NOT_YET_AVAILABLE_EXIT_CODE;
}

function printHelp(commands: CliCommands, io: CliIo): void {
  const names = Object.keys(commands).sort();
  const width = Math.max(0, ...names.map((name) => name.length));
  io.out('Uso: node dist/cli.js <comando> [argomenti]   (in sviluppo: pnpm cli <comando> [argomenti])');
  io.out('');
  io.out('Comandi:');
  for (const name of names) io.out(`  ${name.padEnd(width)}  ${commands[name]?.description ?? ''}`);
}

/** Esegue il CLI con gli argomenti dopo il nome del programma; restituisce il codice di uscita. */
export async function runCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  commands: CliCommands,
  io: CliIo,
): Promise<number> {
  const [name, ...args] = argv;
  if (name === undefined || name === '--help') {
    printHelp(commands, io);
    return 0;
  }

  let parsed: CliEnv;
  try {
    parsed = parseCliEnv(env);
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    // Solo i nomi delle variabili, mai i valori.
    io.err(`Comando ${name} rifiutato. ${error.message}`);
    return FAILURE_EXIT_CODE;
  }

  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (command === undefined) {
    io.err(`Comando sconosciuto: ${name}. L'elenco dei comandi: --help.`);
    return UNKNOWN_COMMAND_EXIT_CODE;
  }

  try {
    return await command.run({ name, args, env: parsed, io });
  } catch (error) {
    io.err(`Comando ${name} non riuscito: ${error instanceof Error ? error.message : String(error)}`);
    return FAILURE_EXIT_CODE;
  }
}
