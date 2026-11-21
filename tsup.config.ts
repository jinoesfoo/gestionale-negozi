// Build dei punti di ingresso fuori da Next.js (01 §Contenuto dell'immagine dell'app, FON-T06): dist/worker.js,
// dist/migrate.js, dist/cli.js e dist/isolation-check.js, ciascuno in un solo file con tutte le dipendenze, perché
// nell'immagine accanto a dist/ c'è solo node_modules dell'output standalone di Next.js (le dipendenze dell'app web).
// Formato ESM, come il package.json del progetto ("type": "module").
import { defineConfig } from 'tsup';

/**
 * I soli moduli lasciati fuori dal file: `pg` li carica solo in casi che qui non servono (`pg-native` con
 * NODE_PG_FORCE_NATIVE o `pg.native`, `pg-cloudflare` nei Cloudflare Workers), e nessuno dei due è installato
 * nell'immagine. In tsup `noExternal` vince su `external`: per questo il modello di `noExternal` li esclude.
 */
const EXTERNAL = ['pg-native', 'pg-cloudflare'];

export default defineConfig({
  entry: {
    worker: 'src/worker.ts',
    migrate: 'src/migrate.ts',
    cli: 'src/cli.ts',
    'isolation-check': 'src/isolation-check.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  noExternal: [new RegExp(`^(?!(${EXTERNAL.join('|')})(/|$))`)],
  external: EXTERNAL,
  // Un file per punto di ingresso, senza parti comuni: nell'immagine si copia dist/ così com'è.
  splitting: false,
  clean: true,
  // Le dipendenze CommonJS incluse nel file chiamano require(), che in un modulo ESM non esiste.
  banner: {
    js: "import { createRequire as __tsupCreateRequire } from 'node:module'; const require = __tsupCreateRequire(import.meta.url);",
  },
  // __dirname e __filename per le dipendenze CommonJS che li usano.
  shims: true,
});
