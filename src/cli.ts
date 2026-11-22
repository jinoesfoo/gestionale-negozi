// Punto di ingresso del CLI (01 §Contenuto dell'immagine dell'app, FON-002, FON-T06): sui server
// `/srv/app/dc run --rm migrate node dist/cli.js <comando>`, con le credenziali del proprietario di migrate.env; in
// sviluppo `pnpm cli <comando>` (con .env.migrate). L'elenco dei comandi è fisso: ogni comando sta nel proprio file di
// src/cli/commands/ (nome del comando con un trattino al posto dei due punti), e il compito che lo scrive cambia solo
// quel file, mai questo. La logica comune (elenco, validazione dell'ambiente, codici di uscita) è in src/cli/run.ts.
import { command as adminGrant } from './cli/commands/admin-grant';
import { command as adminPurgeTestShops } from './cli/commands/admin-purge-test-shops';
import { command as adminReset2fa } from './cli/commands/admin-reset-2fa';
import { command as adminRevoke } from './cli/commands/admin-revoke';
import { command as billingResetCustomer } from './cli/commands/billing-reset-customer';
import { command as billingTestClockCustomer } from './cli/commands/billing-test-clock-customer';
import { command as jobsSend } from './cli/commands/jobs-send';
import { command as opsRecordBackup } from './cli/commands/ops-record-backup';
import { command as opsRecordHostMetrics } from './cli/commands/ops-record-host-metrics';
import { command as opsRecordRestoreTest } from './cli/commands/ops-record-restore-test';
import { command as opsRowCounts } from './cli/commands/ops-row-counts';
import { command as stripeSeed } from './cli/commands/stripe-seed';
import { runCli, type CliCommands, type CliIo } from './cli/run';
import { isEntryPoint } from './lib/entry-point';

/** Tutti i comandi previsti dalle specifiche (aree 01, 03, 05, 07 e 08). */
export const COMMANDS: CliCommands = {
  'admin:grant': adminGrant,
  'admin:revoke': adminRevoke,
  'admin:reset-2fa': adminReset2fa,
  'admin:purge-test-shops': adminPurgeTestShops,
  'billing:reset-customer': billingResetCustomer,
  'billing:test-clock-customer': billingTestClockCustomer,
  'stripe:seed': stripeSeed,
  'ops:record-backup': opsRecordBackup,
  'ops:record-restore-test': opsRecordRestoreTest,
  'ops:record-host-metrics': opsRecordHostMetrics,
  'ops:row-counts': opsRowCounts,
  'jobs:send': jobsSend,
};

const consoleIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

if (isEntryPoint(import.meta.url, 'cli')) {
  // process.exit: un comando che lasciasse aperta una connessione non deve tenere vivo il processo.
  process.exit(await runCli(process.argv.slice(2), process.env, COMMANDS, consoleIo));
}
