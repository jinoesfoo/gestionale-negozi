import { join } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// R-DATI-3 (specs/00-costituzione.md §3): il client del database non si importa fuori da
// src/server/db/, con le eccezioni dichiarate. In eslint.config.mjs la regola no-restricted-imports
// controlla gli import statici e no-restricted-syntax gli import() dinamici, che la prima non vede,
// con gli stessi divieti (01 §Client del database); qui le si prova su file finti, passati a ESLint come testo.
const root = join(import.meta.dirname, '..', '..');
const DB_RULES = new Set(['no-restricted-imports', 'no-restricted-syntax']);
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: root });
});

// Ogni caso si prova in sette forme: import statico; import() con il percorso tra apici e tra apici inversi; dentro
// un'espressione di TypeScript (as, satisfies, !), che sparisce nella compilazione e lascia import('…'); in un ramo di
// un'espressione condizionale.
const forms = {
  statico: (specifier: string) => `import * as mod from '${specifier}';\nexport const used = mod;\n`,
  'import()': (specifier: string) => `export const load = () => import('${specifier}');\n`,
  'import() con apici inversi': (specifier: string) => `export const load = () => import(\`${specifier}\`);\n`,
  'import() con as string': (specifier: string) => `export const load = () => import('${specifier}' as string);\n`,
  'import() con satisfies': (specifier: string) =>
    `export const load = () => import('${specifier}' satisfies string);\n`,
  'import() con !': (specifier: string) => `export const load = () => import('${specifier}'!);\n`,
  'import() condizionale': (specifier: string) =>
    `export const load = (c: boolean) => import(c ? './vuoto' : '${specifier}');\n`,
};
type Form = keyof typeof forms;

async function restrictedImports(filePath: string, specifier: string, form: Form): Promise<number> {
  const [result] = await eslint.lintText(forms[form](specifier), { filePath: join(root, filePath) });
  return (result?.messages ?? []).filter((m) => m.ruleId !== null && DB_RULES.has(m.ruleId)).length;
}

const cases: Array<[file: string, specifier: string, allowed: boolean]> = [
  // Client del database: solo dentro src/server/db/.
  ['src/app/page.tsx', '@/server/db/client', false],
  ['src/app/api/health/route.ts', '../../../server/db/client', false],
  ['src/server/billing/sync.ts', '@/server/db/client', false],
  ['src/worker.ts', '@/server/db/client', false],
  ['src/server/billing/sync.ts', '../db/client', false],
  ['src/server/billing/sync.ts', '../db/client.ts', false],
  // Percorsi non normalizzati, che TypeScript e il bundler risolvono comunque nel client.
  ['src/app/page.tsx', '@/server/db//client', false],
  ['src/server/billing/sync.ts', '../db/./client.ts', false],
  ['src/server/db/with-shop.ts', './client', true],
  ['src/server/db/isolation/fixtures.ts', '../client', true],
  // Driver: solo dentro src/server/db/.
  ['src/app/page.tsx', 'pg', false],
  ['src/server/jobs/boss.ts', 'pg', false],
  ['src/server/audit/audit.ts', 'drizzle-orm/node-postgres', false],
  ['src/server/db/client.ts', 'pg', true],
  ['src/server/db/client.ts', 'drizzle-orm/node-postgres', true],
  ['src/server/jobs/boss.ts', 'pg-pool', false],
  ['src/app/page.tsx', 'pg/lib/client', false],
  // pg-boss è la coda dei lavori (ruolo app_jobs), non il client dei dati: ammesso fuori da src/server/db/.
  ['src/server/jobs/boss.ts', 'pg-boss', true],
  ['src/worker.ts', 'pg-boss', true],
  // Il migratore di Drizzle: solo in src/migrate.ts (01 §Contenuto dell'immagine).
  ['src/migrate.ts', 'drizzle-orm/node-postgres/migrator', true],
  ['src/migrate.ts', 'drizzle-orm/node-postgres', false],
  ['src/migrate.ts', 'pg', false],
  ['src/cli.ts', 'drizzle-orm/node-postgres/migrator', false],
  ['src/server/billing/sync.ts', 'drizzle-orm/node-postgres/migrator', false],
  // Client del proprietario: solo nei punti di ingresso e nei comandi del CLI.
  ['src/migrate.ts', '@/server/db/owner-client', true],
  ['src/cli.ts', './server/db/owner-client', true],
  ['src/isolation-check.ts', '@/server/db/owner-client', true],
  ['src/cli/commands/admin-grant.ts', '@/server/db/owner-client', true],
  ['src/worker.ts', '@/server/db/owner-client', false],
  ['src/app/x-admin/page.tsx', '@/server/db/owner-client', false],
  ['src/server/auth/auth.ts', '@/server/db/owner-client', false],
  ['src/server/db/with-shop.ts', './owner-client', false],
  ['src/server/jobs/boss.ts', '../db/owner-client.ts', false],
  // Adattatore di Better Auth: solo da src/server/auth/auth.ts.
  ['src/server/auth/auth.ts', '@/server/db/auth-adapter', true],
  ['src/server/auth/plugins/session-policy.ts', '@/server/db/auth-adapter', false],
  ['src/app/api/auth/[...all]/route.ts', '@/server/db/auth-adapter', false],
  // Contatori degli hook di accesso: ovunque sotto src/server/auth/.
  ['src/server/auth/auth.ts', '@/server/db/auth-counters', true],
  ['src/server/auth/plugins/pwned-check.ts', '@/server/db/auth-counters', true],
  ['src/app/x-app/page.tsx', '@/server/db/auth-counters', false],
  ['src/server/email/send.ts', '@/server/db/auth-counters', false],
  ['src/server/email/send.ts', '../db/auth-counters', false],
  // I test usano i client per ruolo (tests/fixtures/db.ts).
  ['tests/fixtures/db.ts', '@/server/db/owner-client', true],
  ['tests/fixtures/db.ts', 'pg', true],
  ['tests/integration/example.test.ts', '@/server/db/client', true],
];

describe('regola sugli import del database', () => {
  // Le due regole valgono per ogni file JavaScript e TypeScript di src/, qualunque sia l'estensione.
  it.each(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'])(
    'R-DATI-3: le due regole valgono per i file .%s di src/',
    async (extension) => {
      const config = await eslint.calculateConfigForFile(join(root, `src/app/x/file.${extension}`));
      for (const rule of DB_RULES) expect(config?.rules?.[rule]?.[0], rule).toBe(2);
    },
    60_000,
  );

  for (const form of Object.keys(forms) as Form[]) {
    it.each(cases)(
      `R-DATI-3: %s importa %s (${form}) → ammesso: %s`,
      async (file, specifier, allowed) => {
        const count = await restrictedImports(file, specifier, form);
        expect(count > 0 ? 'vietato' : 'ammesso').toBe(allowed ? 'ammesso' : 'vietato');
      },
      60_000,
    );
  }
});
