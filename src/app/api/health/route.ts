// GET /api/health (FON-009): stato dell'app e del database, senza login, su ogni host (02 §Instradamento, punto 1).
import { appVersion, hasPlaceholders } from '@/config/env';
import { pingDatabase } from '@/server/db/ping';
import { createHealthHandler } from '@/server/health';

// Ogni richiesta prova il database: niente risposta calcolata durante la build né in cache.
export const dynamic = 'force-dynamic';

const handler = createHealthHandler({
  pingDb: pingDatabase,
  version: () => appVersion(process.env),
  placeholders: () => hasPlaceholders(process.env),
});

export async function GET(): Promise<Response> {
  return handler();
}
