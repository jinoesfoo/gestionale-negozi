import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHostResolver,
  RESOLVE_HOST_MAX_ENTRIES,
  RESOLVE_HOST_NEGATIVE_TTL_MS,
  RESOLVE_HOST_TTL_MS,
  type ResolvedHost,
} from '@/server/db/resolve-host';

// 02 §Instradamento (punto 5) e NEG-T02, nota (5) del piano: resolveHost(host), che il proxy di NEG-T04 chiama per gli
// host dei negozi, porta l'host in minuscolo e senza porta, interroga resolve_host solo per <etichetta>.<dominio>
// (un'etichetta nel formato di NEG-001) e tiene la cache: 60 s per un negozio trovato, 10 s per un risultato vuoto, al
// massimo un numero fissato di host. Il tempo è valutato in JavaScript: l'orologio è iniettato (00 §5); quello
// predefinito è monotono (nota (14) del ritorno al piano).

afterEach(() => {
  vi.restoreAllMocks();
});

const FOUND: ResolvedHost = {
  shopId: '0195f3c1-7a2b-7c3d-8e4f-5a6b7c8d9e0f',
  subdomain: 'negozio-a',
  status: 'trial',
  name: 'Negozio A',
};

interface SetupOptions {
  baseDomain?: string;
  maxEntries?: number;
}

/**
 * Un risolutore con l'orologio in mano al test; gli host che iniziano con `vuoto-` non hanno un negozio. Ogni ricerca
 * restituisce un oggetto nuovo, come una riga letta dal database.
 */
function setup(options: SetupOptions = {}) {
  let clock = 0;
  const lookup = vi.fn(async (host: string): Promise<ResolvedHost | null> =>
    host.startsWith('vuoto-') ? null : { ...FOUND },
  );
  const resolve = createHostResolver({
    baseDomain: options.baseDomain ?? 'localhost',
    lookup,
    now: () => clock,
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
  });
  return {
    resolve,
    lookup,
    at(ms: number) {
      clock = ms;
    },
  };
}

describe('host', () => {
  it('NEG-006: porta l’host in minuscolo e senza porta e interroga resolve_host con l’host intero', async () => {
    const { resolve, lookup } = setup();
    await expect(resolve('Negozio-A.LOCALHOST:3000')).resolves.toEqual(FOUND);
    expect(lookup).toHaveBeenCalledExactlyOnceWith('negozio-a.localhost');
  });

  it('NEG-006: confronta il dominio di base in minuscolo', async () => {
    const { resolve, lookup } = setup({ baseDomain: 'Example.COM' });
    await expect(resolve('negozio-a.example.com')).resolves.toEqual(FOUND);
    expect(lookup).toHaveBeenCalledExactlyOnceWith('negozio-a.example.com');
  });

  it('NEG-006: accetta etichette di 3 e di 40 caratteri, nel formato di NEG-001', async () => {
    const { resolve, lookup } = setup();
    await resolve('abc.localhost');
    await resolve(`${'a'.repeat(39)}b.localhost`);
    await resolve('a-1.localhost');
    expect(lookup.mock.calls.map(([host]) => host)).toEqual([
      'abc.localhost',
      `${'a'.repeat(39)}b.localhost`,
      'a-1.localhost',
    ]);
  });

  it('NEG-006: un host che non è <etichetta>.<dominio di base>, con un’etichetta nel formato di NEG-001, dà null senza interrogare il database', async () => {
    const { resolve, lookup } = setup();
    const hosts = [
      '',
      'localhost',
      'localhost:3000',
      '.localhost',
      'negozio-a.altro.it',
      'negozio-a.localhost.altro',
      'negozio-a.sub.localhost',
      'negozio-a.localhost.',
      'ab.localhost',
      `${'a'.repeat(41)}.localhost`,
      '-negozio.localhost',
      'negozio-.localhost',
      'negozio_a.localhost',
      'negozio a.localhost',
      'negozio%2ea.localhost',
      '[::1]:3000',
      '127.0.0.1',
      // La normalizzazione è solo il minuscolo e la rimozione di `:<cifre>` alla fine (nota (14)).
      'negozio-a.localhost:',
      'negozio-a.localhost:abc',
      'negozio-a.localhost.:3000',
      '[::1]',
    ];
    for (const host of hosts) {
      await expect(resolve(host), host).resolves.toBeNull();
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('NEG-006: un host scartato esce prima della cache e non toglie voci a una cache piena', async () => {
    const { resolve, lookup, at } = setup({ maxEntries: 2 });
    at(0);
    await resolve('uno.localhost');
    await resolve('due.localhost');
    for (const host of ['localhost', 'negozio-a.altro.it', 'ab.localhost', 'negozio-a.localhost.']) {
      await expect(resolve(host), host).resolves.toBeNull();
    }
    lookup.mockClear();
    at(1);
    await resolve('uno.localhost');
    await resolve('due.localhost');
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('cache', () => {
  it('NEG-010: un negozio trovato resta in cache 60 secondi', async () => {
    const { resolve, lookup, at } = setup();
    at(0);
    await expect(resolve('negozio-a.localhost')).resolves.toEqual(FOUND);
    at(59_999);
    await expect(resolve('negozio-a.localhost')).resolves.toEqual(FOUND);
    expect(lookup).toHaveBeenCalledTimes(1);
    // Una voce vale finché l'orologio è minore della scadenza: a 60 000 ms esatti è già scaduta (nota (14)).
    at(60_000);
    await expect(resolve('negozio-a.localhost')).resolves.toEqual(FOUND);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('NEG-010: la durata di una voce si conta dall’arrivo della risposta del database, non dall’inizio della ricerca', async () => {
    const { resolve, lookup, at } = setup();
    at(0);
    lookup.mockImplementationOnce(async () => {
      at(5_000);
      return { ...FOUND };
    });
    await resolve('negozio-a.localhost');
    at(64_999);
    await resolve('negozio-a.localhost');
    expect(lookup).toHaveBeenCalledTimes(1);
    at(65_000);
    await resolve('negozio-a.localhost');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('NEG-010: un risultato vuoto resta in cache 10 secondi', async () => {
    const { resolve, lookup, at } = setup();
    at(0);
    await expect(resolve('vuoto-uno.localhost')).resolves.toBeNull();
    at(9_999);
    await expect(resolve('vuoto-uno.localhost')).resolves.toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
    at(10_000);
    await expect(resolve('vuoto-uno.localhost')).resolves.toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('NEG-010: l’orologio predefinito è monotono: un salto all’indietro dell’ora di sistema non allunga le voci', async () => {
    const realPerformanceNow = performance.now.bind(performance);
    const realDateNow = Date.now.bind(Date);
    let monotonicOffset = 0;
    let wallOffset = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => realPerformanceNow() + monotonicOffset);
    vi.spyOn(Date, 'now').mockImplementation(() => realDateNow() + wallOffset);
    const lookup = vi.fn(async (): Promise<ResolvedHost | null> => null);
    const resolve = createHostResolver({ baseDomain: 'localhost', lookup });

    await resolve('vuoto-uno.localhost');
    // L'ora di sistema torna indietro di un'ora, mentre il tempo vero avanza di 10 secondi.
    wallOffset = -3_600_000;
    monotonicOffset = RESOLVE_HOST_NEGATIVE_TTL_MS;
    await resolve('vuoto-uno.localhost');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('NEG-010: una lettura dalla cache non salva la voce più vecchia: si toglie nell’ordine di scrittura', async () => {
    const { resolve, lookup, at } = setup({ maxEntries: 3 });
    at(0);
    await resolve('uno.localhost');
    at(1);
    await resolve('due.localhost');
    at(2);
    await resolve('tre.localhost');
    at(3);
    await resolve('uno.localhost');
    expect(lookup).toHaveBeenCalledTimes(3);
    at(4);
    await resolve('quattro.localhost');
    lookup.mockClear();
    at(5);
    await resolve('due.localhost');
    expect(lookup).not.toHaveBeenCalled();
    await resolve('uno.localhost');
    expect(lookup).toHaveBeenCalledExactlyOnceWith('uno.localhost');
  });

  it('NEG-010: una voce riletta dal database dopo la scadenza torna in fondo, fra le più nuove', async () => {
    const { resolve, lookup, at } = setup({ maxEntries: 2 });
    at(0);
    await resolve('uno.localhost');
    at(30_000);
    await resolve('due.localhost');
    at(60_000);
    await resolve('uno.localhost');
    expect(lookup).toHaveBeenCalledTimes(3);
    at(60_001);
    await resolve('tre.localhost');
    lookup.mockClear();
    at(60_002);
    await resolve('uno.localhost');
    expect(lookup).not.toHaveBeenCalled();
    await resolve('due.localhost');
    expect(lookup).toHaveBeenCalledExactlyOnceWith('due.localhost');
  });

  it('NEG-010: dopo la scadenza un errore della ricerca risale al chiamante senza il valore scaduto, e la chiamata successiva cerca di nuovo', async () => {
    const { resolve, lookup, at } = setup();
    at(0);
    await expect(resolve('negozio-a.localhost')).resolves.toEqual(FOUND);
    const failure = new Error('database non raggiungibile');
    lookup.mockRejectedValueOnce(failure);
    at(60_000);
    await expect(resolve('negozio-a.localhost')).rejects.toBe(failure);
    at(60_001);
    await expect(resolve('negozio-a.localhost')).resolves.toEqual(FOUND);
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it('NEG-010: il negozio in cache è congelato: chi lo riceve non può cambiarlo per le richieste successive', async () => {
    const { resolve } = setup();
    const first = await resolve('negozio-a.localhost');
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { name: string }).name = 'Nome cambiato';
    }).toThrow(TypeError);
    await expect(resolve('negozio-a.localhost')).resolves.toEqual(FOUND);
  });

  it('NEG-010: la cache è per host, e lo stesso host in maiuscolo o con la porta usa la stessa voce', async () => {
    const { resolve, lookup } = setup();
    await resolve('negozio-a.localhost');
    await resolve('NEGOZIO-A.localhost:3000');
    await resolve('negozio-b.localhost');
    expect(lookup.mock.calls.map(([host]) => host)).toEqual(['negozio-a.localhost', 'negozio-b.localhost']);
  });

  it('NEG-010: un errore del database non entra in cache e risale al chiamante', async () => {
    const { resolve, lookup } = setup();
    const failure = new Error('database non raggiungibile');
    lookup.mockRejectedValueOnce(failure);
    await expect(resolve('negozio-a.localhost')).rejects.toBe(failure);
    await expect(resolve('negozio-a.localhost')).resolves.toEqual(FOUND);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('NEG-010: quando la cache è piena toglie prima una voce scaduta, anche se non è la più vecchia', async () => {
    const { resolve, lookup, at } = setup({ maxEntries: 3 });
    at(0);
    await resolve('uno.localhost');
    at(1);
    await resolve('vuoto-due.localhost');
    at(2);
    await resolve('tre.localhost');
    at(20_000);
    await resolve('quattro.localhost');
    lookup.mockClear();
    at(20_001);
    await resolve('uno.localhost');
    await resolve('tre.localhost');
    await resolve('quattro.localhost');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('NEG-010: quando la cache è piena e nessuna voce è scaduta toglie la più vecchia', async () => {
    const { resolve, lookup, at } = setup({ maxEntries: 3 });
    at(0);
    await resolve('uno.localhost');
    at(1);
    await resolve('due.localhost');
    at(2);
    await resolve('tre.localhost');
    at(3);
    await resolve('quattro.localhost');
    lookup.mockClear();
    at(4);
    await resolve('due.localhost');
    await resolve('tre.localhost');
    await resolve('quattro.localhost');
    expect(lookup).not.toHaveBeenCalled();
    await resolve('uno.localhost');
    expect(lookup).toHaveBeenCalledExactlyOnceWith('uno.localhost');
  });

  it('NEG-010: senza maxEntries il risolutore tiene al massimo 10 000 host', async () => {
    const { resolve, lookup, at } = setup();
    at(0);
    const hosts = Array.from({ length: 10_001 }, (_, i) => `n${String(i).padStart(5, '0')}.localhost`);
    for (const host of hosts) await resolve(host);
    expect(lookup).toHaveBeenCalledTimes(10_001);
    lookup.mockClear();
    await resolve(hosts[2]!);
    expect(lookup).not.toHaveBeenCalled();
    await resolve(hosts[0]!);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(hosts[0]);
  });

  it('NEG-010: la cache vale 60 secondi per un negozio, 10 per un risultato vuoto, al massimo 10 000 host', () => {
    expect(RESOLVE_HOST_TTL_MS).toBe(60_000);
    expect(RESOLVE_HOST_NEGATIVE_TTL_MS).toBe(10_000);
    expect(RESOLVE_HOST_MAX_ENTRIES).toBe(10_000);
  });
});
