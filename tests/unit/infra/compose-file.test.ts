import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// I tag delle immagini in infra/compose.yml (01 §CI/CD, FON-T06; DOM-T02 in 06 §Compiti), letti come testo: il
// controllo di check-compose.ts lavora sulla configurazione già risolta, dove la forma `${APP_TAG:?…}` non si vede più.
// /srv/app/.env DEVE contenere i tre tag: con `${X_TAG:?messaggio}` Compose rifiuta di caricare il progetto, per
// qualunque comando di /srv/app/dc, se uno manca o è vuoto, e il messaggio nomina la variabile. Con `${X_TAG}` darebbe
// solo un avviso, e l'errore arriverebbe più tardi, scaricando o creando quel servizio. Che Compose rifiuti davvero il
// progetto si prova con Docker nella lista di controllo docs/verifiche/fon-t06.md (C3).

const COMPOSE = fileURLToPath(new URL('../../../infra/compose.yml', import.meta.url));

/** Il tag che ogni immagine deve usare. */
const TAG_OF_IMAGE: Record<string, string> = {
  caddy: 'CADDY_TAG',
  app: 'APP_TAG',
  postgres: 'POSTGRES_TAG',
};

interface ImageLine {
  line: string;
  image: string;
  variable: string;
  message: string;
}

/** Le righe `image:` di infra/compose.yml, scomposte: immagine, variabile del tag, messaggio dopo `:?`. */
function imageLines(): ImageLine[] {
  return readFileSync(COMPOSE, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^image:\s/.test(line))
    .map((line) => {
      const match =
        /^image:\s+(['"]?)ghcr\.io\/jinoesfoo\/gestionale-negozi-([a-z]+):\$\{([A-Z_]+):\?([^}]*)\}\1$/.exec(line);
      return {
        line,
        image: match?.[2] ?? '',
        variable: match?.[3] ?? '',
        message: match?.[4] ?? '',
      };
    });
}

describe('tag delle immagini in infra/compose.yml', () => {
  it('FON-002: ogni immagine richiede il suo tag con ${X_TAG:?…}, senza valore predefinito', () => {
    const lines = imageLines();
    // caddy, app, worker, migrate, postgres.
    expect(lines).toHaveLength(5);
    for (const { line, image, variable } of lines) {
      expect(image, `forma ghcr.io/jinoesfoo/gestionale-negozi-<nome>:\${X_TAG:?…}: ${line}`).not.toBe('');
      expect(variable, line).toBe(TAG_OF_IMAGE[image]);
    }
  });

  it('FON-002: il messaggio di un tag mancante nomina la variabile e il file /srv/app/.env', () => {
    for (const { line, variable, message } of imageLines()) {
      expect(variable, `forma \${X_TAG:?messaggio}: ${line}`).not.toBe('');
      expect(message, line).toContain(variable);
      expect(message, line).toContain('/srv/app/.env');
    }
  });

  it('FON-002: si usano tutti e tre i tag (CADDY_TAG, APP_TAG, POSTGRES_TAG)', () => {
    const used = new Set(imageLines().map(({ variable }) => variable));
    expect([...used].sort()).toEqual(['APP_TAG', 'CADDY_TAG', 'POSTGRES_TAG']);
  });
});
