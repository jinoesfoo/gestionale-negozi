// Configurazione di ESLint (flat config).
// La regola no-restricted-imports applica R-DATI-3 (specs/00-costituzione.md §3):
// il client del database non si importa fuori da src/server/db/, con le eccezioni elencate.
// I modelli guardano la fine del percorso, così valgono anche gli import relativi (../db/client, ./owner-client).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Pacchetti del driver elencati uno per uno: un modello 'pg-*' vieterebbe anche pg-boss, che è la coda
// dei lavori (ruolo app_jobs, src/server/jobs/boss.ts), non il client dei dati.
const DB_DRIVERS = [
  'pg',
  'pg-pool',
  'pg-native',
  'pg-cursor',
  'pg-query-stream',
  'postgres',
  'drizzle-orm/node-postgres',
  'drizzle-orm/node-postgres/*',
];
// Il migratore di Drizzle si usa in src/migrate.ts (01 §Contenuto dell'immagine); il resto del driver no.
const MIGRATOR = 'drizzle-orm/node-postgres/migrator';

const dbPatterns = {
  client: {
    group: ['**/db/client', '**/db/client.*'],
    message: 'R-DATI-3: il client del database si usa solo dentro src/server/db/ (accesso ai dati con withShop).',
  },
  owner: {
    group: ['**/owner-client', '**/owner-client.*'],
    message:
      'R-DATI-3: owner-client si importa solo da src/migrate.ts, src/cli.ts, src/isolation-check.ts e src/cli/commands/**.',
  },
  adapter: {
    group: ['**/auth-adapter', '**/auth-adapter.*'],
    message: 'R-DATI-3: auth-adapter si importa solo da src/server/auth/auth.ts.',
  },
  counters: {
    group: ['**/auth-counters', '**/auth-counters.*'],
    message: 'R-DATI-3: auth-counters si importa solo da src/server/auth/**.',
  },
  drivers: {
    group: DB_DRIVERS,
    message: 'R-DATI-3: i driver del database si usano solo dentro src/server/db/.',
  },
  // Come drivers, ma con il migratore ammesso (solo per src/migrate.ts).
  // Una negazione in group non basta: drizzle-orm/node-postgres esclude anche ciò che sta sotto.
  driversExceptMigrator: [
    {
      group: DB_DRIVERS.filter((d) => !d.startsWith('drizzle-orm/')),
      message: 'R-DATI-3: i driver del database si usano solo dentro src/server/db/.',
    },
    {
      regex: `^drizzle-orm/node-postgres(?!/migrator$)(/.*)?$`,
      message: `R-DATI-3: i driver del database si usano solo dentro src/server/db/ (qui è ammesso solo ${MIGRATOR}).`,
    },
  ],
};

/** Regola con i soli modelli indicati (le altre restrizioni restano quelle elencate). */
const restrict = (...keys) => ({
  'no-restricted-imports': ['error', { patterns: keys.flatMap((k) => dbPatterns[k]) }],
});

const ALL = ['client', 'owner', 'adapter', 'counters', 'drivers'];
const without = (...keys) => ALL.filter((k) => !keys.includes(k));

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      '.claude/**',
      'registro/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  // App Router: niente cartella pages/, la regola sui link di pages/ non serve.
  { rules: { '@next/next/no-html-link-for-pages': 'off' } },
  // Tutto src/: nessun accesso diretto al database.
  { files: ['src/**/*.{ts,tsx,mts,js,mjs}'], rules: restrict(...ALL) },
  // Dentro src/server/db/ client e driver sono liberi; owner-client resta riservato ai punti di ingresso.
  { files: ['src/server/db/**'], rules: restrict('owner') },
  // Punti di ingresso con le credenziali del proprietario.
  {
    files: ['src/migrate.ts', 'src/cli.ts', 'src/isolation-check.ts', 'src/cli/commands/**'],
    rules: restrict(...without('owner')),
  },
  // src/migrate.ts esegue le migrazioni con il migratore di Drizzle.
  { files: ['src/migrate.ts'], rules: restrict('client', 'adapter', 'counters', 'driversExceptMigrator') },
  // Plugin e callback di Better Auth: auth-counters ovunque sotto src/server/auth/.
  { files: ['src/server/auth/**'], rules: restrict(...without('counters')) },
  // L'adattatore di Better Auth solo nella configurazione.
  { files: ['src/server/auth/auth.ts'], rules: restrict(...without('counters', 'adapter')) },
  // I test (aiuto tests/fixtures/db.ts) usano i client per ruolo.
  { files: ['tests/**'], rules: { 'no-restricted-imports': 'off' } },
];
export default config;
