import { describe, expect, it } from 'vitest';
import { openJobSecret, sealJobSecret } from '@/server/jobs/seal';

// 00 §4.3: un token in chiaro che passa per una coda (per esempio il link d'invito nel lavoro `email.send`) si cifra
// con AES-256-GCM e la chiave JOB_PAYLOAD_KEY (32 byte in base64), che hanno solo app e worker: le righe di
// pgboss.job, i WAL e i backup contengono solo il testo cifrato. Nessun requisito con ID copre 00 §4.3: i test portano
// `00§4.3` nel nome (nota (2) del piano di FON-T10).

const key = (byte: number) => Buffer.alloc(32, byte).toString('base64');
const LINK = 'https://app.localhost/invito/VALORE-PROVA-TOKEN-0123456789abcdef';

describe('cifratura dei segreti nei lavori (src/server/jobs/seal.ts)', () => {
  it('00§4.3: il testo cifrato si riapre con la stessa chiave e non contiene il testo in chiaro', () => {
    const sealed = sealJobSecret(LINK, key(1));
    expect(sealed).not.toContain(LINK);
    expect(sealed).not.toContain('VALORE-PROVA-TOKEN');
    expect(openJobSecret(sealed, key(1))).toBe(LINK);
  });

  it('00§4.3: due cifrature dello stesso testo sono diverse (vettore iniziale casuale)', () => {
    expect(sealJobSecret(LINK, key(1))).not.toBe(sealJobSecret(LINK, key(1)));
  });

  it('00§4.3: con un’altra chiave il testo non si apre', () => {
    const sealed = sealJobSecret(LINK, key(1));
    expect(() => openJobSecret(sealed, key(2))).toThrow();
  });

  it('00§4.3: un testo cifrato alterato non si apre (GCM ne controlla l’integrità)', () => {
    const sealed = sealJobSecret(LINK, key(1));
    // Cambia un carattere a metà del testo cifrato, restando nell'alfabeto base64url.
    const middle = Math.floor(sealed.length / 2);
    const swapped = sealed[middle] === 'A' ? 'B' : 'A';
    const altered = sealed.slice(0, middle) + swapped + sealed.slice(middle + 1);
    expect(altered).not.toBe(sealed);
    expect(() => openJobSecret(altered, key(1))).toThrow();
    expect(() => openJobSecret('non-un-testo-cifrato', key(1))).toThrow();
  });

  it('00§4.3: una chiave che non è di 32 byte è rifiutata, con il nome della variabile e senza il valore', () => {
    const short = Buffer.alloc(16, 7).toString('base64');
    for (const bad of [short, '']) {
      let message = '';
      try {
        sealJobSecret(LINK, bad);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, `chiave «${bad}»`).toContain('JOB_PAYLOAD_KEY');
      if (bad !== '') expect(message).not.toContain(bad);
    }
  });

  it('00§4.3: senza chiave esplicita usa JOB_PAYLOAD_KEY dell’ambiente', () => {
    const previous = process.env.JOB_PAYLOAD_KEY;
    process.env.JOB_PAYLOAD_KEY = key(3);
    try {
      const sealed = sealJobSecret(LINK);
      expect(openJobSecret(sealed, key(3))).toBe(LINK);
      expect(openJobSecret(sealed)).toBe(LINK);
    } finally {
      if (previous === undefined) delete process.env.JOB_PAYLOAD_KEY;
      else process.env.JOB_PAYLOAD_KEY = previous;
    }
  });
});
