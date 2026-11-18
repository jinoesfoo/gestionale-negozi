// Configurazione di ESLint (flat config).
// R-DATI-3 (specs/00-costituzione.md §3): il client del database non si importa fuori da src/server/db/, con le
// eccezioni elencate. no-restricted-imports controlla gli import statici e gli export … from, ma non gli import()
// dinamici: per quelli c'è no-restricted-syntax, con gli stessi divieti (01 §Client del database).
// Ogni divieto è un'espressione regolare sul percorso dell'import, la stessa per le due regole. I moduli del progetto
// si riconoscono dalla fine del percorso, così valgono anche gli import relativi (../db/client, ./owner-client).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Pacchetti del driver elencati uno per uno: un modello 'pg-*' vieterebbe anche pg-boss, che è la coda
// dei lavori (ruolo app_jobs, src/server/jobs/boss.ts), non il client dei dati.
const DB_DRIVERS = ['pg', 'pg-pool', 'pg-native', 'pg-cursor', 'pg-query-stream', 'postgres'];
// Il migratore di Drizzle si usa in src/migrate.ts (01 §Contenuto dell'immagine); il resto del driver no.
const MIGRATOR = 'drizzle-orm/node-postgres/migrator';

/**
 * Un file del progetto, con o senza estensione, in qualunque cartella: `…/db/client`, `../db/client.ts`. Fra le
 * cartelle del nome sono ammessi `/` e `./` ripetuti (`@/server/db//client`, `db/./client`), che TypeScript e il
 * bundler risolvono comunque nello stesso file.
 */
const projectFile = (path) => `(^|/)${path.split('/').join('/(\\./|/)*')}(\\.[^/]*)?(/|$)`;
/** Un pacchetto o un suo sottomodulo, a qualunque livello del percorso: `pg`, `pg/lib/client`. */
const anyOf = (names) => `(^|/)(${names.join('|')})(/|$)`;

const DRIVERS_MESSAGE = 'R-DATI-3: i driver del database si usano solo dentro src/server/db/.';

const dbPatterns = {
  client: [
    {
      regex: projectFile('db/client'),
      message: 'R-DATI-3: il client del database si usa solo dentro src/server/db/ (accesso ai dati con withShop).',
    },
  ],
  owner: [
    {
      regex: projectFile('owner-client'),
      message:
        'R-DATI-3: owner-client si importa solo da src/migrate.ts, src/cli.ts, src/isolation-check.ts e src/cli/commands/**.',
    },
  ],
  adapter: [
    {
      regex: projectFile('auth-adapter'),
      message: 'R-DATI-3: auth-adapter si importa solo da src/server/auth/auth.ts.',
    },
  ],
  counters: [
    {
      regex: projectFile('auth-counters'),
      message: 'R-DATI-3: auth-counters si importa solo da src/server/auth/**.',
    },
  ],
  drivers: [
    { regex: anyOf(DB_DRIVERS), message: DRIVERS_MESSAGE },
    { regex: '^drizzle-orm/node-postgres(/|$)', message: DRIVERS_MESSAGE },
  ],
  // Come drivers, ma con il migratore ammesso (solo per src/migrate.ts).
  driversExceptMigrator: [
    { regex: anyOf(DB_DRIVERS), message: DRIVERS_MESSAGE },
    {
      regex: '^drizzle-orm/node-postgres(?!/migrator$)(/|$)',
      message: `R-DATI-3: i driver del database si usano solo dentro src/server/db/ (qui è ammesso solo ${MIGRATOR}).`,
    },
  ],
};

/**
 * Lo stesso divieto per gli import() dinamici: il percorso, tra apici o tra apici inversi senza `${…}`, si cerca in
 * tutta l'espressione dell'import(), così vale anche dentro `as`, `satisfies` o `!` di TypeScript.
 * Nei selettori di esquery la barra chiude l'espressione regolare, quindi dentro si scrive `\/`; il flag `i` è quello
 * di no-restricted-imports, che senza `caseSensitive` non distingue maiuscole e minuscole.
 */
const dynamicImport = ({ regex, message }) => {
  const pattern = `/${regex.replaceAll('/', '\\/')}/iu`;
  return [
    { selector: `ImportExpression Literal[value=${pattern}]`, message },
    { selector: `ImportExpression TemplateLiteral[expressions.length=0][quasis.0.value.cooked=${pattern}]`, message },
  ];
};

/**
 * Regole con i soli divieti indicati, per gli import statici e dinamici. Un blocco successivo che vale per lo stesso
 * file sostituisce le due regole per intero (le altre restrizioni restano quelle elencate qui); no-restricted-syntax
 * serve solo a R-DATI-3: un altro uso andrebbe aggiunto a questa funzione.
 */
const restrict = (...keys) => {
  const patterns = keys.flatMap((k) => dbPatterns[k]);
  return {
    'no-restricted-imports': ['error', { patterns }],
    'no-restricted-syntax': ['error', ...patterns.flatMap(dynamicImport)],
  };
};

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
  // Tutto src/, ogni file JavaScript e TypeScript: nessun accesso diretto al database.
  { files: ['src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'], rules: restrict(...ALL) },
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
  { files: ['tests/**'], rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' } },
];
export default config;
