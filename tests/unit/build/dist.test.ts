import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recognizableValues, validCliEnv, validWorkerEnv, without, type TestEnv } from '../../fixtures/env';

// I quattro punti di ingresso costruiti con tsup.config.ts (01 §Contenuto dell'immagine dell'app, FON-T06), eseguiti
// come nell'immagine: `node dist/<nome>.js`. La build va in una cartella temporanea, lontana da node_modules: un
// modulo lasciato fuori dal file per sbaglio farebbe fallire il caricamento (nell'immagine, accanto a dist/, ci sono
// solo le dipendenze dell'app web). Accanto ai file c'è un package.json con "type": "module", come nell'immagine.

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSUP = join(ROOT, 'node_modules/tsup/dist/cli-default.js');
const ENTRY_POINTS = ['worker.js', 'migrate.js', 'cli.js', 'isolation-check.js'];
const COMMANDS = [
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
const BUILD_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 30_000;

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'fon-t06-dist-'));
  execFileSync(process.execPath, [TSUP, '--out-dir', outDir], { cwd: ROOT, stdio: 'pipe' });
  writeFileSync(join(outDir, 'package.json'), '{ "type": "module" }\n');
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

/** Esegue `node <file> <argomenti>` con solo l'ambiente dato (nessuna variabile ereditata dai test). */
function run(file: string, args: string[], env: TestEnv) {
  const result = spawnSync(process.execPath, [join(outDir, file), ...args], {
    cwd: outDir,
    // I tipi di Next.js vogliono NODE_ENV in ProcessEnv: qui l'ambiente ha solo le variabili date, anche nessuna.
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
}

function expectNoValues(text: string, env: TestEnv) {
  for (const value of recognizableValues(env)) expect(text).not.toContain(value);
}

describe('punti di ingresso costruiti con tsup', { timeout: RUN_TIMEOUT_MS + 5_000 }, () => {
  it('FON-006: tsup costruisce i quattro punti di ingresso in file .js', () => {
    expect(readdirSync(outDir)).toEqual(expect.arrayContaining(ENTRY_POINTS));
  });

  it('FON-002: node dist/cli.js --help elenca i comandi ed esce con 0 senza nessuna variabile d’ambiente', () => {
    const result = run('cli.js', ['--help'], {});
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    for (const name of COMMANDS) expect(result.stdout).toContain(name);
  });

  it('FON-002: node dist/cli.js senza argomenti elenca i comandi ed esce con 0 senza nessuna variabile d’ambiente', () => {
    const result = run('cli.js', [], {});
    expect(result.status).toBe(0);
    for (const name of COMMANDS) expect(result.stdout).toContain(name);
  });

  it('FON-002: node dist/cli.js admin:grant x@y.it senza DATABASE_OWNER_URL termina con errore che ne contiene il nome', () => {
    const env = without(validCliEnv(), 'DATABASE_OWNER_URL');
    const result = run('cli.js', ['admin:grant', 'x@y.it'], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_OWNER_URL');
    expectNoValues(result.stdout + result.stderr, env);
  });

  it('FON-002: node dist/worker.js senza DATABASE_URL termina con codice diverso da 0 e il nome della variabile', () => {
    const env = without(validWorkerEnv(), 'DATABASE_URL');
    const result = run('worker.js', [], env);
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DATABASE_URL');
    expectNoValues(result.stdout + result.stderr, env);
  });

  it('FON-002: node dist/worker.js con DATABASE_OWNER_URL presente termina con errore', () => {
    const env = {
      ...validWorkerEnv(),
      DATABASE_OWNER_URL: 'postgres://app_owner:VALORE-PROVA-PW-OWNER@localhost:5432/app',
    };
    const result = run('worker.js', [], env);
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DATABASE_OWNER_URL');
    expectNoValues(result.stdout + result.stderr, env);
  });

  it('FON-002: node dist/migrate.js senza DATABASE_OWNER_URL termina con codice diverso da 0 e il nome della variabile', () => {
    const env = without(validCliEnv(), 'DATABASE_OWNER_URL');
    const result = run('migrate.js', [], env);
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DATABASE_OWNER_URL');
    expectNoValues(result.stdout + result.stderr, env);
  });

  it('FON-006: node dist/isolation-check.js (segnaposto) termina con «non ancora disponibile» e codice 1', () => {
    const result = run('isolation-check.js', [], {});
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('non ancora disponibile');
  });
});
