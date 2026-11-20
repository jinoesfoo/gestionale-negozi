import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Progetti di Vitest (01 §Variabili d'ambiente):
// - `unit`: test unitari e di architettura, senza database e senza file di ambiente (girano nella sandbox e in CI);
// - `int-app`: integrazione con il codice dell'app, DATABASE_URL = TEST_DATABASE_APP_URL (ruolo app_user);
// - `int-worker`: integrazione con il codice del worker, DATABASE_URL = TEST_DATABASE_WORKER_URL (ruolo app_worker).
// I due progetti di integrazione caricano .env.test e .env.test.owner nel setup, prima di importare il codice.
const INTEGRATION_TIMEOUT_MS = 60_000;

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/architecture/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'int-app',
          include: ['tests/integration/app/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/int-app.ts'],
          testTimeout: INTEGRATION_TIMEOUT_MS,
          hookTimeout: INTEGRATION_TIMEOUT_MS,
        },
      },
      {
        extends: true,
        test: {
          name: 'int-worker',
          include: ['tests/integration/worker/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/int-worker.ts'],
          testTimeout: INTEGRATION_TIMEOUT_MS,
          hookTimeout: INTEGRATION_TIMEOUT_MS,
        },
      },
    ],
  },
});
