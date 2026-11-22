import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS } from '@/cli';
import { NOT_YET_AVAILABLE_EXIT_CODE, notYetAvailable, runCli, type CliCommand, type CliIo } from '@/cli/run';
import { recognizableValues, validCliEnv, without } from '../../fixtures/env';

// FON-002 per il CLI (01 §Contenuto dell'immagine dell'app, FON-T06): l'elenco dei comandi si stampa prima della
// validazione dell'ambiente; ogni altro comando, anche uno non ancora scritto, valida lo schema del CLI per primo. Il
// codice 64 («non ancora disponibile») è riservato ai segnaposto e si prova sulla funzione comune, con un comando finto
// registrato solo qui: i comandi veri li scrivono altri compiti, anche di yoo, che non toccano questo file.

/** I comandi previsti dalle specifiche (aree 01, 07 e 08): l'elenco di src/cli.ts non cambia più. */
const EXPECTED_COMMANDS = [
  'admin:grant',
  'admin:revoke',
  'admin:reset-2fa',
  'admin:purge-test-shops',
  'billing:reset-customer',
  'billing:test-clock-customer',
  'stripe:seed',
  'ops:record-backup',
  'ops:record-restore-test',
  'ops:record-host-metrics',
  'ops:row-counts',
  'jobs:send',
];

const FAKE = 'finto:comando';

/** Uscite in memoria del CLI. */
function memoryIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (line) => out.push(line), err: (line) => err.push(line) };
  return { io, out: () => out.join('\n'), err: () => err.join('\n') };
}

/** Un comando finto che registra le chiamate e termina con il codice dato. */
function spyCommand(code = 0) {
  const run = vi.fn<CliCommand['run']>(() => code);
  const command: CliCommand = { description: 'Comando finto dei test.', run };
  return { command, run };
}

function expectNoValues(text: string, env: Record<string, string | undefined>) {
  for (const value of recognizableValues(env)) expect(text).not.toContain(value);
}

describe('CLI: elenco dei comandi', () => {
  it('FON-002: --help stampa l’elenco dei comandi ed esce con 0 senza nessuna variabile d’ambiente', async () => {
    const { io, out } = memoryIo();
    expect(await runCli(['--help'], {}, COMMANDS, io)).toBe(0);
    for (const name of EXPECTED_COMMANDS) expect(out()).toContain(name);
  });

  it('FON-002: senza argomenti stampa l’elenco dei comandi ed esce con 0 senza nessuna variabile d’ambiente', async () => {
    const { io, out } = memoryIo();
    expect(await runCli([], {}, COMMANDS, io)).toBe(0);
    for (const name of EXPECTED_COMMANDS) expect(out()).toContain(name);
  });

  it('FON-002: l’elenco non valida l’ambiente, non esegue comandi e non scrive valori', async () => {
    const { command, run } = spyCommand();
    const env = { ...validCliEnv(), DATABASE_OWNER_URL: 'non-un-indirizzo-VALORE-PROVA' };
    for (const argv of [['--help'], []]) {
      const { io, out, err } = memoryIo();
      expect(await runCli(argv, env, { [FAKE]: command }, io)).toBe(0);
      expect(out()).toContain(FAKE);
      expect(out()).toContain(command.description);
      expect(err()).toBe('');
      expectNoValues(`${out()}\n${err()}`, env);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('FON-002: src/cli.ts elenca tutti i comandi delle specifiche, ognuno con il proprio file in src/cli/commands/', async () => {
    expect(Object.keys(COMMANDS).sort()).toEqual([...EXPECTED_COMMANDS].sort());
    for (const name of EXPECTED_COMMANDS) {
      const file = fileURLToPath(new URL(`../../../src/cli/commands/${name.replace(':', '-')}.ts`, import.meta.url));
      expect(existsSync(file), `${name}: manca ${file}`).toBe(true);
      const commandModule = (await import(/* @vite-ignore */ file)) as { command?: CliCommand };
      expect(COMMANDS[name], `${name}: in src/cli.ts deve essere il comando del suo file`).toBe(commandModule.command);
      expect(COMMANDS[name]?.description.trim()).not.toBe('');
    }
  });
});

describe('CLI: validazione dell’ambiente prima di ogni comando', () => {
  it('FON-002: admin:grant senza DATABASE_OWNER_URL termina con errore che ne contiene il nome, senza valori', async () => {
    const env = without(validCliEnv(), 'DATABASE_OWNER_URL');
    const { io, out, err } = memoryIo();
    expect(await runCli(['admin:grant', 'x@y.it'], env, COMMANDS, io)).toBe(1);
    expect(err()).toContain('DATABASE_OWNER_URL');
    expectNoValues(`${out()}\n${err()}`, env);
  });

  it('FON-002: un comando, anche non ancora scritto, valida lo schema del CLI prima di qualsiasi altra cosa', async () => {
    const { command, run } = spyCommand();
    const { io, err } = memoryIo();
    expect(await runCli([FAKE], {}, { [FAKE]: command }, io)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(err()).toContain('DATABASE_OWNER_URL');
    expect(err()).toContain('ADMIN_ALERT_EMAIL');
  });

  it('FON-002: con DATABASE_OWNER_URL non valida il comando non parte e il valore non si scrive', async () => {
    const { command, run } = spyCommand();
    const env = { ...validCliEnv(), DATABASE_OWNER_URL: 'mysql://app_owner:VALORE-PROVA-PW-OWNER@localhost/app' };
    const { io, out, err } = memoryIo();
    expect(await runCli([FAKE], env, { [FAKE]: command }, io)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(err()).toContain('DATABASE_OWNER_URL');
    expectNoValues(`${out()}\n${err()}`, env);
  });

  it('FON-002: con un ambiente valido il comando riceve il nome, gli argomenti e l’ambiente validato', async () => {
    const { command, run } = spyCommand(0);
    const env = validCliEnv();
    const { io } = memoryIo();
    expect(await runCli([FAKE, 'x@y.it', '--kind', 'full'], env, { [FAKE]: command }, io)).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      name: FAKE,
      args: ['x@y.it', '--kind', 'full'],
      env: { DATABASE_OWNER_URL: env.DATABASE_OWNER_URL, ADMIN_ALERT_EMAIL: env.ADMIN_ALERT_EMAIL },
      io,
    });
  });

  it('FON-002: il codice di uscita è quello restituito dal comando', async () => {
    const { command } = spyCommand(7);
    const { io } = memoryIo();
    expect(await runCli([FAKE], validCliEnv(), { [FAKE]: command }, io)).toBe(7);
  });
});

describe('CLI: segnaposto e codice riservato 64', () => {
  it('FON-002: la funzione comune dei segnaposto scrive «non ancora disponibile» ed esce con il codice riservato 64', async () => {
    expect(NOT_YET_AVAILABLE_EXIT_CODE).toBe(64);
    const placeholder: CliCommand = { description: 'Segnaposto finto dei test.', run: notYetAvailable };
    const { io, err } = memoryIo();
    expect(await runCli([FAKE], validCliEnv(), { [FAKE]: placeholder }, io)).toBe(64);
    expect(err()).toContain(FAKE);
    expect(err()).toContain('non ancora disponibile');
  });

  it('FON-002: anche il segnaposto valida prima l’ambiente: senza variabili termina con 1, non con 64', async () => {
    const placeholder: CliCommand = { description: 'Segnaposto finto dei test.', run: notYetAvailable };
    const { io, err } = memoryIo();
    expect(await runCli([FAKE], {}, { [FAKE]: placeholder }, io)).toBe(1);
    expect(err()).not.toContain('non ancora disponibile');
  });

  it('FON-002: un comando sconosciuto, con un ambiente valido, termina con 2 e rimanda a --help', async () => {
    const { io, err } = memoryIo();
    expect(await runCli(['non:esiste'], validCliEnv(), COMMANDS, io)).toBe(2);
    expect(err()).toContain('non:esiste');
    expect(err()).toContain('--help');
  });

  it('FON-002: un comando sconosciuto valida comunque prima l’ambiente', async () => {
    const { io, err } = memoryIo();
    expect(await runCli(['non:esiste'], {}, COMMANDS, io)).toBe(1);
    expect(err()).toContain('DATABASE_OWNER_URL');
  });

  it('FON-002: un errore del comando termina con 1, mai con il codice riservato 64', async () => {
    const failing: CliCommand = {
      description: 'Comando finto che fallisce.',
      run: () => {
        throw new Error('guasto di prova');
      },
    };
    const { io, err } = memoryIo();
    expect(await runCli([FAKE], validCliEnv(), { [FAKE]: failing }, io)).toBe(1);
    expect(err()).toContain(FAKE);
    expect(err()).toContain('guasto di prova');
  });
});
