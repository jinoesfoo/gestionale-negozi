import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Il contesto della build dell'immagine dell'app (FON-T06): `.dockerignore` nella radice toglie almeno `.git`,
// `node_modules`, `.next`, i file di ambiente veri (`**/.env`, `**/.env.*`, tranne gli esempi; `infra/env.example/`
// resta) e `playwright/.auth/`, perché la build locale manda il contesto al demone di Docker, che lo legge fuori dalla
// sandbox. Il file è a elenco chiuso (nota (7) del piano di FON-T06): fuori anche `.claude/`, `registro/` e i file
// che la sandbox monta nella radice.
//
// Le regole si applicano come BuildKit (moby/patternmatcher, MatchesUsingParentResults): righe che iniziano con `#`
// ignorate, spazi tolti, percorsi puliti come filepath.Clean e senza `/` iniziale; `*` e `?` non attraversano `/`,
// `**` sì; una regola vale anche per tutto ciò che sta sotto la cartella che corrisponde; l'ultima regola che
// corrisponde decide, e `!` riammette. La prova con Docker vero è in docs/verifiche/fon-t06.md
// (tests/fixtures/docker-context.Dockerfile).

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** filepath.Clean di Go, per percorsi con `/`. */
function clean(path: string): string {
  const absolute = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push('..');
    } else {
      parts.push(part);
    }
  }
  const joined = parts.join('/');
  if (absolute) return `/${joined}`;
  return joined === '' ? '.' : joined;
}

/** Le regole di .dockerignore, come ReadAll di BuildKit. */
function readPatterns(text: string): string[] {
  const patterns: string[] = [];
  for (const [index, raw] of text.split('\n').entries()) {
    const line = index === 0 ? raw.replace(/^﻿/, '') : raw;
    if (line.startsWith('#')) continue;
    let pattern = line.trim();
    if (pattern === '') continue;
    const invert = pattern.startsWith('!');
    if (invert) pattern = pattern.slice(1).trim();
    if (pattern.length > 0) {
      pattern = clean(pattern);
      if (pattern.length > 1 && pattern.startsWith('/')) pattern = pattern.slice(1);
    }
    patterns.push(invert ? `!${pattern}` : pattern);
  }
  return patterns;
}

type MatchType = 'exact' | 'prefix' | 'suffix' | 'regexp';
interface Pattern {
  exclusion: boolean;
  cleaned: string;
  type: MatchType;
  regexp?: RegExp;
}

/** Una regola compilata come Pattern.compile di moby/patternmatcher. */
function compile(raw: string): Pattern {
  let text = clean(raw.trim());
  const exclusion = text.startsWith('!');
  if (exclusion) text = text.slice(1);
  let regexp = '^';
  let type: MatchType = 'exact';
  const chars = [...text];
  // `step` conta i passi del ciclo come `i` nel codice Go: un `**/` iniziale si consuma tutto nel passo 0.
  for (let i = 0, step = 0; i < chars.length; i++, step++) {
    const ch = chars[i];
    if (ch === '*') {
      if (chars[i + 1] === '*') {
        i++;
        if (chars[i + 1] === '/') i++;
        if (i + 1 >= chars.length) {
          if (type === 'exact') type = 'prefix';
          else {
            regexp += '.*';
            type = 'regexp';
          }
        } else {
          regexp += '(.*/)?';
          type = 'regexp';
        }
        if (step === 0) type = 'suffix';
      } else {
        regexp += '[^/]*';
        type = 'regexp';
      }
    } else if (ch === '?') {
      regexp += '[^/]';
      type = 'regexp';
    } else if (ch === '[' || ch === ']') {
      regexp += ch;
      type = 'regexp';
    } else if (ch === '\\') {
      if (i + 1 < chars.length) {
        i++;
        regexp += `\\${chars[i]}`;
        type = 'regexp';
      } else {
        regexp += '\\\\';
      }
    } else if ('.+()|{}$^'.includes(ch ?? '')) {
      regexp += `\\${ch}`;
    } else {
      regexp += ch;
    }
  }
  regexp += '$';
  return type === 'regexp'
    ? { exclusion, cleaned: text, type, regexp: new RegExp(regexp) }
    : { exclusion, cleaned: text, type };
}

function matches(pattern: Pattern, path: string): boolean {
  switch (pattern.type) {
    case 'exact':
      return path === pattern.cleaned;
    case 'prefix':
      return path.startsWith(pattern.cleaned.slice(0, -2));
    case 'suffix': {
      const suffix = pattern.cleaned.slice(2);
      if (path.endsWith(suffix)) return true;
      return suffix.startsWith('/') && path === suffix.slice(1);
    }
    case 'regexp':
      return pattern.regexp?.test(path) ?? false;
  }
}

/**
 * Vero se il percorso resta fuori dal contesto. Come il walker di BuildKit: si valuta ogni cartella dalla radice in
 * giù, e per ogni regola si riusa il risultato della cartella che contiene il percorso.
 */
function isExcluded(patterns: Pattern[], path: string): boolean {
  const parts = path.split('/');
  let parentMatched: boolean[] | undefined;
  let excluded = false;
  for (let depth = 1; depth <= parts.length; depth++) {
    const current = parts.slice(0, depth).join('/');
    const matchedHere: boolean[] = [];
    excluded = false;
    patterns.forEach((pattern, index) => {
      matchedHere[index] = false;
      if (pattern.exclusion !== excluded) return;
      const match = parentMatched?.[index] === true || matches(pattern, current);
      matchedHere[index] = match;
      if (match) excluded = !pattern.exclusion;
    });
    parentMatched = matchedHere;
  }
  return excluded;
}

function loadDockerignore(): Pattern[] {
  return readPatterns(readFileSync(join(ROOT, '.dockerignore'), 'utf8')).map(compile);
}

describe('regole di .dockerignore applicate come BuildKit (prova del metodo di confronto)', () => {
  const rules = (...lines: string[]) => readPatterns(lines.join('\n')).map(compile);

  it('FON-006: una cartella esclusa porta fuori tutto ciò che contiene, e ! la riammette', () => {
    const patterns = rules('*', '!src', '**/.env');
    expect(isExcluded(patterns, 'README.md')).toBe(true);
    expect(isExcluded(patterns, '.git/HEAD')).toBe(true);
    expect(isExcluded(patterns, 'src/cli.ts')).toBe(false);
    expect(isExcluded(patterns, 'src/.env')).toBe(true);
    expect(isExcluded(patterns, '.env')).toBe(true);
  });

  it('FON-006: * e ? non attraversano le cartelle, ** sì', () => {
    const patterns = rules('**/.env.*', 'a/*.md', '!**/*.example');
    expect(isExcluded(patterns, '.env.app')).toBe(true);
    expect(isExcluded(patterns, 'x/y/.env.local')).toBe(true);
    expect(isExcluded(patterns, 'x/y/.env.app.example')).toBe(false);
    expect(isExcluded(patterns, 'a/b.md')).toBe(true);
    expect(isExcluded(patterns, 'a/b/c.md')).toBe(false);
  });
});

describe('contesto della build dell’immagine dell’app (.dockerignore)', () => {
  it.each([
    '.git/HEAD',
    '.git/config',
    'node_modules/next/package.json',
    'node_modules/.pnpm/pg@8.23.1/node_modules/pg/package.json',
    'src/node_modules/x/index.js',
    'infra/node_modules/x/index.js',
    '.next/cache/webpack/x.pack',
    '.next/standalone/server.js',
    'src/.next/x',
    'playwright/.auth/admin.json',
  ])('FON-006: %s resta fuori dal contesto', (path) => {
    expect(isExcluded(loadDockerignore(), path)).toBe(true);
  });

  it.each([
    '.env',
    '.env.app',
    '.env.worker',
    '.env.migrate',
    '.env.test',
    '.env.test.owner',
    '.env.local',
    '.env.collaudo',
    'src/.env',
    'src/.env.local',
    'src/config/.env.production',
    'drizzle/.env',
    'infra/.env',
    'infra/.env.prod',
    'infra/env.example/.env',
    'infra/scripts/.env.local',
  ])('FON-006: il file di ambiente %s resta fuori dal contesto', (path) => {
    expect(isExcluded(loadDockerignore(), path)).toBe(true);
  });

  it.each([
    '.claude/settings.local.json',
    '.claude/hooks/common.sh',
    'registro/compiti-joo.log',
    'CLAUDE.local.md',
    '.mcp.json',
    '.bashrc',
    '.gitconfig',
    '.ripgreprc',
    '.vscode/settings.json',
    '.idea/workspace.xml',
    'dist/cli.js',
    'coverage/index.html',
    'tests/unit/cli/cli.test.ts',
    'specs/01-fondamenta.md',
    'docs/due-postazioni.md',
  ])('FON-006: %s (non serve alla build) resta fuori dal contesto', (path) => {
    expect(isExcluded(loadDockerignore(), path)).toBe(true);
  });

  it.each([
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'next.config.ts',
    'tsconfig.json',
    'tsup.config.ts',
    'src/cli.ts',
    'src/cli/commands/admin-grant.ts',
    'drizzle/meta/_journal.json',
    'infra/compose.yml',
    'infra/scripts/dc',
    'infra/env.example/app.env',
    'infra/env.example/migrate.env',
  ])('FON-006: %s (serve alla build o all’immagine) entra nel contesto', (path) => {
    expect(isExcluded(loadDockerignore(), path)).toBe(false);
  });

  it('FON-006: entrano nel contesto tutti i file tracciati da git di src/, drizzle/ e infra/', () => {
    const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', 'drizzle', 'infra'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\0')
      .filter((path) => path !== '');
    expect(tracked.length).toBeGreaterThan(0);
    const patterns = loadDockerignore();
    expect(tracked.filter((path) => isExcluded(patterns, path))).toEqual([]);
  });
});
