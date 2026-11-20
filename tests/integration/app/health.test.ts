import { afterAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';
import { closeDb } from '@/server/db/client';

// FON-009: con il database che risponde, GET /api/health risponde 200 con {status, version, db, placeholders}, senza
// login e senza esporre dati. La route è quella vera, con il client dell'app (DATABASE_URL = TEST_DATABASE_APP_URL,
// ruolo app_user); il 503 con il database finto è nel test unitario tests/unit/server/health.test.ts.

afterAll(async () => {
  await closeDb();
});

describe('GET /api/health con il database vero', () => {
  it('FON-009: risponde 200 con stato, versione, database e segnaposto, e nient’altro', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['db', 'placeholders', 'status', 'version']);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    // .env.test non ha APP_VERSION: con APP_ENV=test vale il predefinito `dev` (01 §CI/CD).
    expect(body.version).toBe('dev');
    expect(typeof body.placeholders).toBe('boolean');
  });
});
