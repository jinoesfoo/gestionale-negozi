// Ambiente dei test di integrazione (01 §Variabili d'ambiente). Carica .env.test (credenziali dei ruoli di runtime e
// variabili di app e worker con valori di prova) e .env.test.owner (solo TEST_DATABASE_OWNER_URL, per
// tests/fixtures/db.ts), poi copia in DATABASE_URL la connessione del ruolo del processo simulato. Gira come setup del
// progetto Vitest, prima che i test importino il codice. Gli errori nominano file e variabili, mai i valori.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');

const ENV_FILES = ['.env.test', '.env.test.owner'];

const ROLE_URL = {
  app: 'TEST_DATABASE_APP_URL',
  worker: 'TEST_DATABASE_WORKER_URL',
} as const;

export function loadTestEnv(role: keyof typeof ROLE_URL): void {
  for (const file of ENV_FILES) {
    const path = join(root, file);
    if (!existsSync(path)) {
      throw new Error(`Manca ${file}: crealo copiando ${file}.example (AVVIO.md, «Fuori da GitHub»).`);
    }
    process.loadEnvFile(path);
  }
  const name = ROLE_URL[role];
  const url = process.env[name];
  if (url === undefined || url === '') {
    throw new Error(`Manca ${name} in .env.test: confrontalo con .env.test.example.`);
  }
  process.env.DATABASE_URL = url;
}
