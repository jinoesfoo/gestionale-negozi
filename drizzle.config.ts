// Configurazione di drizzle-kit, solo in sviluppo (01 §Contenuto dell'immagine): genera in drizzle/ le migrazioni dallo
// schema di src/server/db/schema/ (un file per tabella, raccolti in index.ts). Le applica src/migrate.ts con il
// migratore di drizzle-orm, nello stesso registro (schema drizzle, tabella __drizzle_migrations). `generate` non si
// collega al database: nessuna credenziale qui.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
});
