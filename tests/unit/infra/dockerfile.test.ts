import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Il Dockerfile dell'immagine dell'app (01 §Contenuto dell'immagine dell'app e §Servizi Docker Compose, FON-T06),
// letto come testo: le regole della specifica che si vedono nel file. La build vera e il contenuto dell'immagine si
// provano con Docker nella lista di controllo docs/verifiche/fon-t06.md.

const DOCKERFILE = fileURLToPath(new URL('../../../Dockerfile', import.meta.url));

/** Le istruzioni del Dockerfile, con le righe continuate da `\` unite e senza commenti né righe vuote. */
function instructions(): string[] {
  const text = readFileSync(DOCKERFILE, 'utf8').replace(/\\\r?\n/g, ' ');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Le istruzioni dell'ultima fase (dall'ultimo FROM in poi). */
function finalStage(): string[] {
  const all = instructions();
  const lastFrom = all.findLastIndex((line) => /^FROM\s/i.test(line));
  expect(lastFrom).toBeGreaterThanOrEqual(0);
  return all.slice(lastFrom);
}

describe('Dockerfile dell’immagine dell’app', () => {
  it('FON-006: è a più fasi e ogni immagine di base è fissata per versione', () => {
    const froms = instructions().filter((line) => /^FROM\s/i.test(line));
    expect(froms.length).toBeGreaterThan(1);
    for (const from of froms) {
      const image = from.split(/\s+/)[1] ?? '';
      // Una fase precedente (FROM deps AS build) non è un'immagine da scaricare.
      if (!image.includes(':') && !image.includes('@')) continue;
      expect(image, from).toMatch(/:\d+\.\d+\.\d+|@sha256:/);
    }
  });

  it('FON-006: la fase finale ha la label org.opencontainers.image.source con l’indirizzo del repository', () => {
    expect(finalStage()).toContainEqual(
      expect.stringMatching(
        /^LABEL\s+org\.opencontainers\.image\.source="?https:\/\/github\.com\/jinoesfoo\/gestionale-negozi"?$/,
      ),
    );
  });

  it('FON-006: la fase finale riceve APP_VERSION come argomento di build e la scrive nell’ambiente dell’immagine', () => {
    const stage = finalStage();
    const arg = stage.findIndex((line) => /^ARG\s+APP_VERSION(\s|=|$)/.test(line));
    const env = stage.findIndex((line) => /^ENV\s+APP_VERSION[=\s]+"?\$\{?APP_VERSION\}?"?$/.test(line));
    expect(arg, 'ARG APP_VERSION nella fase finale').toBeGreaterThan(0);
    expect(env, 'ENV APP_VERSION=$APP_VERSION dopo ARG').toBeGreaterThan(arg);
  });

  it('FON-006: la fase finale copia infra/ in /opt/infra', () => {
    // Dal contesto (`COPY infra /opt/infra`) o da una fase precedente (`COPY --from=build /build/infra /opt/infra`),
    // con o senza opzioni (`--from`, `--chown`) fra COPY e la sorgente.
    expect(finalStage()).toContainEqual(
      expect.stringMatching(/^COPY\s+(--\S+\s+)*(\S*\/)?infra\/?\s+\/opt\/infra\/?$/),
    );
  });

  it('FON-006: il comando predefinito avvia il server standalone di Next.js (node server.js)', () => {
    expect(finalStage()).toContainEqual(expect.stringMatching(/^CMD\s+\[\s*"node"\s*,\s*"server\.js"\s*\]$/));
  });
});
