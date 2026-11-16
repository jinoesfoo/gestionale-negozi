import { join } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// R-DATI-3 (specs/00-costituzione.md §3): il client del database non si importa fuori da
// src/server/db/, con le eccezioni dichiarate. La regola è no-restricted-imports in
// eslint.config.mjs; qui la si prova su file finti, passati a ESLint come testo.
const root = join(import.meta.dirname, '..', '..');
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: root });
});

async function restrictedImports(filePath: string, specifier: string): Promise<number> {
  const code = `import * as mod from '${specifier}';\nexport const used = mod;\n`;
  const [result] = await eslint.lintText(code, { filePath: join(root, filePath) });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').length;
}

const cases: Array<[file: string, specifier: string, allowed: boolean]> = [
  // Client del database: solo dentro src/server/db/.
  ['src/app/page.tsx', '@/server/db/client', false],
  ['src/app/api/health/route.ts', '../../../server/db/client', false],
  ['src/server/billing/sync.ts', '@/server/db/client', false],
  ['src/worker.ts', '@/server/db/client', false],
  ['src/server/billing/sync.ts', '../db/client', false],
  ['src/server/billing/sync.ts', '../db/client.ts', false],
  ['src/server/db/with-shop.ts', './client', true],
  ['src/server/db/isolation/fixtures.ts', '../client', true],
  // Driver: solo dentro src/server/db/.
  ['src/app/page.tsx', 'pg', false],
  ['src/server/jobs/boss.ts', 'pg', false],
  ['src/server/audit/audit.ts', 'drizzle-orm/node-postgres', false],
  ['src/server/db/client.ts', 'pg', true],
  ['src/server/db/client.ts', 'drizzle-orm/node-postgres', true],
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
  it.each(cases)(
    'R-DATI-3: %s importa %s → ammesso: %s',
    async (file, specifier, allowed) => {
      const count = await restrictedImports(file, specifier);
      expect(count > 0 ? 'vietato' : 'ammesso').toBe(allowed ? 'ammesso' : 'vietato');
    },
    60_000,
  );
});
