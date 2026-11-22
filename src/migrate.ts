// Migrazioni del database (01 §Contenuto dell'immagine, FON-004): il migratore di drizzle-orm applica i file di
// drizzle/ non ancora registrati in drizzle.__drizzle_migrations, con le credenziali del proprietario
// (DATABASE_OWNER_URL, app_owner). In sviluppo `pnpm db:migrate`; sui server `dist/migrate.js` (FON-T06), con la
// cartella drizzle/ accanto a dist/. Valida l'ambiente e migra solo quando è il programma lanciato: importato (il test
// di FON-004 chiama runMigrations) non fa nulla.
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { EnvError, parseMigrateEnv } from '@/config/env';
import { isEntryPoint } from '@/lib/entry-point';
import { createOwnerConnection } from '@/server/db/owner-client';

/** drizzle/ nella radice del progetto: da src/migrate.ts e da dist/migrate.js è la cartella sopra. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applica le migrazioni mancanti come il ruolo dell'indirizzo dato; su un database aggiornato non cambia nulla. */
export async function runMigrations(url: string): Promise<void> {
  const owner = createOwnerConnection(url);
  try {
    await migrate(owner.db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
  } finally {
    await owner.close();
  }
}

async function main(): Promise<void> {
  let ownerUrl: string;
  try {
    ownerUrl = parseMigrateEnv(process.env).DATABASE_OWNER_URL;
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    // Solo i nomi delle variabili, mai i valori.
    console.error(`Migrazioni rifiutate. ${error.message}`);
    process.exit(1);
  }
  await runMigrations(ownerUrl);
  console.log('Migrazioni applicate.');
}

if (isEntryPoint(import.meta.url, 'migrate')) {
  main().catch((error: unknown) => {
    console.error('Migrazioni non riuscite.', error);
    process.exit(1);
  });
}
