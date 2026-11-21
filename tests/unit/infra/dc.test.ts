import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Lo script infra/scripts/dc (01 §CI/CD, FON-T06; installato sui server come /srv/app/dc in DOM-T02): imposta
// `docker compose -p app --project-directory /srv/app --env-file /srv/app/.env` e i due file compose dell'ambiente
// scritto in /srv/app/deploy-env (`test` o `prod`; un file mancante o un altro valore è un errore). Qui gira in una
// cartella temporanea (DC_ROOT al posto di /srv/app) con un `docker` finto, che scrive gli argomenti ricevuti.

const DC = fileURLToPath(new URL('../../../infra/scripts/dc', import.meta.url));

/** Il docker finto: scrive gli argomenti separati da NUL in DOCKER_ARGS_FILE ed esce con DOCKER_EXIT_CODE (0). */
const FAKE_DOCKER = `#!/bin/sh
printf '%s\\0' "$@" > "$DOCKER_ARGS_FILE"
exit "\${DOCKER_EXIT_CODE:-0}"
`;

let root: string;
let argsFile: string;
let binDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fon-t06-dc-'));
  argsFile = join(root, 'docker-args');
  binDir = join(root, 'bin');
  mkdirSync(binDir);
  writeFileSync(join(binDir, 'docker'), FAKE_DOCKER);
  chmodSync(join(binDir, 'docker'), 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function runDc(args: string[], env: Record<string, string> = { DC_ROOT: root }) {
  const childEnv: Record<string, string> = {
    PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    DOCKER_ARGS_FILE: argsFile,
    ...env,
  };
  const result = spawnSync(DC, args, {
    // I tipi di Next.js vogliono NODE_ENV in ProcessEnv: qui l'ambiente ha solo le variabili date.
    env: childEnv as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.error) throw result.error;
  const dockerArgs = existsSync(argsFile) ? readFileSync(argsFile, 'utf8').split('\0').slice(0, -1) : undefined;
  return { status: result.status, stderr: result.stderr, dockerArgs };
}

function composeArgs(environment: 'test' | 'prod'): string[] {
  return [
    'compose',
    '-p',
    'app',
    '--project-directory',
    root,
    '--env-file',
    `${root}/.env`,
    '-f',
    `${root}/infra/compose.yml`,
    '-f',
    `${root}/infra/compose.${environment}.yml`,
  ];
}

describe('script dc (infra/scripts/dc)', () => {
  it('FON-006: è uno script eseguibile', () => {
    expect(statSync(DC).mode & 0o111).not.toBe(0);
  });

  it('FON-006: con deploy-env «test» chiama docker compose con il progetto app e i file compose di test', () => {
    writeFileSync(join(root, 'deploy-env'), 'test\n');
    const result = runDc(['ps', '--format', 'json']);
    expect(result.status).toBe(0);
    expect(result.dockerArgs).toEqual([...composeArgs('test'), 'ps', '--format', 'json']);
  });

  it('FON-006: con deploy-env «prod» usa i file compose di produzione e passa gli argomenti intatti', () => {
    writeFileSync(join(root, 'deploy-env'), 'prod\n');
    const args = ['run', '--rm', 'migrate', 'node', 'dist/cli.js', 'admin:grant', 'nome con spazi@example.com', ''];
    const result = runDc(args);
    expect(result.status).toBe(0);
    expect(result.dockerArgs).toEqual([...composeArgs('prod'), ...args]);
  });

  it('FON-006: accetta deploy-env anche senza il ritorno a capo finale', () => {
    writeFileSync(join(root, 'deploy-env'), 'test');
    const result = runDc(['ps']);
    expect(result.status).toBe(0);
    expect(result.dockerArgs).toEqual([...composeArgs('test'), 'ps']);
  });

  it('FON-006: senza deploy-env termina con errore e non chiama docker', () => {
    const result = runDc(['ps']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('deploy-env');
    expect(result.dockerArgs).toBeUndefined();
  });

  it.each(['', '\n', 'staging\n', 'Test\n', ' test\n', 'test \n', 'test\nprod\n', 'prod\r\n', 'test\n\n'])(
    'FON-006: con deploy-env %j termina con errore e non chiama docker',
    (content) => {
      writeFileSync(join(root, 'deploy-env'), content);
      const result = runDc(['ps']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('deploy-env');
      expect(result.dockerArgs).toBeUndefined();
    },
  );

  it('FON-006: termina con il codice di uscita di docker compose', () => {
    writeFileSync(join(root, 'deploy-env'), 'test\n');
    const result = runDc(['up', '-d'], { DC_ROOT: root, DOCKER_EXIT_CODE: '3' });
    expect(result.status).toBe(3);
    expect(result.dockerArgs).toEqual([...composeArgs('test'), 'up', '-d']);
  });

  it('FON-006: senza DC_ROOT usa /srv/app (qui non esiste /srv/app/deploy-env: errore, docker non chiamato)', () => {
    const result = runDc(['ps'], {});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/srv/app/deploy-env');
    expect(result.dockerArgs).toBeUndefined();
  });
});
