import { describe, expect, it } from 'vitest';
import { createHealthHandler } from '@/server/health';

// FON-009: GET /api/health risponde 200 con {status, version, db, placeholders} quando il database risponde, 503
// altrimenti, senza login e senza esporre dati. Qui con un database finto (il 200 con il database vero è nel test di
// integrazione tests/integration/app/health.test.ts).

const KEYS = ['db', 'placeholders', 'status', 'version'];

const handler = (overrides: Partial<Parameters<typeof createHealthHandler>[0]> = {}) =>
  createHealthHandler({
    pingDb: async () => {},
    version: () => 'versione-di-prova',
    placeholders: () => false,
    ...overrides,
  });

async function call(overrides: Partial<Parameters<typeof createHealthHandler>[0]> = {}) {
  const response = await handler(overrides)();
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

describe('GET /api/health (createHealthHandler)', () => {
  it('FON-009: con il database che risponde, 200 con stato, versione, database e segnaposto, e nient’altro', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body).toEqual({ status: 'ok', version: 'versione-di-prova', db: 'ok', placeholders: false });
  });

  it('FON-009: con il database in errore, 503 senza i dettagli dell’errore', async () => {
    const { status, body, text } = await call({
      pingDb: async () => {
        throw new Error('connessione rifiutata: password=SEGRETO-DI-PROVA host=db-interno');
      },
    });
    expect(status).toBe(503);
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body).toMatchObject({ status: 'error', version: 'versione-di-prova', db: 'error' });
    expect(text).not.toContain('SEGRETO-DI-PROVA');
    expect(text).not.toContain('db-interno');
    expect(text).not.toContain('connessione rifiutata');
  });

  it('FON-009: con il database che non risponde entro il tempo massimo, 503', async () => {
    const started = Date.now();
    const { status, body } = await call({ pingDb: () => new Promise<void>(() => {}), timeoutMs: 50 });
    expect(status).toBe(503);
    expect(body).toMatchObject({ status: 'error', db: 'error' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('FON-009: placeholders dice solo vero o falso, senza nominare la variabile', async () => {
    const { status, body, text } = await call({ placeholders: () => true });
    expect(status).toBe(200);
    expect(body.placeholders).toBe(true);
    expect(text).not.toMatch(/STRIPE|SENTRY|EMAIL|SDI_|placeholder-/);
  });

  it('FON-009: lo stato non dipende dai segnaposto (503 anche con placeholders falso)', async () => {
    const { status, body } = await call({
      placeholders: () => false,
      pingDb: async () => {
        throw new Error('giù');
      },
    });
    expect(status).toBe(503);
    expect(body.placeholders).toBe(false);
  });
});
