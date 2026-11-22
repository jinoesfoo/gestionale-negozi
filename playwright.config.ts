import { defineConfig, devices } from '@playwright/test';

// Configurazione minima: gli end-to-end, il webServer con le variabili di .env.test
// e i progetti arrivano con i compiti che li usano (01 §Variabili d'ambiente, NEG-T04).
export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
