import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Progetti di Vitest: `unit` (test unitari e di architettura, senza database).
// I progetti di integrazione `int-app` e `int-worker` (01 §Variabili d'ambiente) li aggiunge FON-T03.
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
    ],
  },
});
