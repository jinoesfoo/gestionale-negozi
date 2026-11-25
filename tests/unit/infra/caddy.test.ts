import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// L'immagine Caddy (06 §Caddy, DOM-T02): infra/caddy/Caddyfile, infra/caddy/Dockerfile, infra/versions.env e la rete
// edge di infra/compose.yml (06 §DNS), letti come testo. Il Caddyfile del repository è la revisione con il
// reverse_proxy (nota (1) del piano di DOM-T02 in 06 §Compiti): quella di avvio, con `respond "In arrivo -
// {remote_host}" 200` al posto di `reverse_proxy app:3000`, esiste solo in un commit del ramo e nell'immagine
// `2.11.9-1`. La costruzione, le versioni dentro le immagini, la prova del filtro dei registri con Docker
// (tests/infra/caddy-log/prova.sh) e le prove sui server stanno nella lista di controllo docs/verifiche/dom-t02.md.

const ROOT = new URL('../../../', import.meta.url);
const CADDYFILE = 'infra/caddy/Caddyfile';
const DOCKERFILE = 'infra/caddy/Dockerfile';
const VERSIONS = 'infra/versions.env';
const COMPOSE = 'infra/compose.yml';
const LOG_TEST = 'tests/infra/caddy-log/Caddyfile';
const LOG_TEST_CONTROL = 'tests/infra/caddy-log/Caddyfile-senza-filtro';

/** Gli intervalli da cui Brevo invia i webhook (06 §Caddy, esito del [VERIFICA] di DOM-T02, 24/11/2026). */
const BREVO_WEBHOOK_RANGES = ['1.179.112.0/20', '172.246.240.0/20'];

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, ROOT)), 'utf8');
}

// --- Lettura del Caddyfile -------------------------------------------------------------------------------------------

/** Una riga del Caddyfile (direttiva, matcher, indirizzi di un sito), con il suo blocco se ne apre uno. */
interface Entry {
  tokens: string[];
  block: Entry[] | null;
}

/** La forma di una riga, come oggetto semplice: per i confronti. */
interface Shape {
  tokens: string[];
  block: Shape[] | null;
}

interface Token {
  text: string;
  quoted: boolean;
}

/**
 * Le parole di una riga, come le divide Caddy: spazi e tabulazioni separano, le virgolette doppie (con `\"`) e gli apici
 * inversi tengono insieme, `#` all'inizio di una parola comincia un commento. Le graffe dei segnaposto (`{$NOME}`,
 * `{env.NOME}`, `{remote_host}`) restano dentro la parola.
 */
function tokenize(line: string, lineNumber: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line.charAt(i);
    if (c === ' ' || c === '\t') {
      i += 1;
      continue;
    }
    if (c === '#') break;
    if (c === '"' || c === '`') {
      let text = '';
      let j = i + 1;
      let closed = false;
      while (j < line.length) {
        const d = line.charAt(j);
        if (c === '"' && d === '\\' && line.charAt(j + 1) === '"') {
          text += '"';
          j += 2;
          continue;
        }
        if (d === c) {
          closed = true;
          j += 1;
          break;
        }
        text += d;
        j += 1;
      }
      if (!closed) throw new Error(`riga ${lineNumber}: virgolette non chiuse`);
      tokens.push({ text, quoted: true });
      i = j;
      continue;
    }
    let j = i;
    while (j < line.length && line.charAt(j) !== ' ' && line.charAt(j) !== '\t') j += 1;
    tokens.push({ text: line.slice(i, j), quoted: false });
    i = j;
  }
  return tokens;
}

/** Il Caddyfile come albero di righe: una riga che finisce con `{` apre un blocco, una riga con la sola `}` lo chiude. */
function parseCaddyfile(text: string): Entry[] {
  const root: Entry[] = [];
  const stack: Entry[][] = [root];
  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    const tokens = tokenize(raw, lineNumber);
    if (tokens.length === 0) return;
    const current = stack.at(-1);
    if (current === undefined) throw new Error(`riga ${lineNumber}: struttura dei blocchi persa`);
    const isBrace = (token: Token | undefined, brace: string) =>
      token !== undefined && !token.quoted && token.text === brace;
    if (tokens.length === 1 && isBrace(tokens[0], '}')) {
      if (stack.length === 1) throw new Error(`riga ${lineNumber}: } senza un blocco aperto`);
      stack.pop();
      return;
    }
    const opens = isBrace(tokens.at(-1), '{');
    const words = opens ? tokens.slice(0, -1) : tokens;
    if (words.some((token) => isBrace(token, '{') || isBrace(token, '}'))) {
      throw new Error(`riga ${lineNumber}: graffa in mezzo alla riga`);
    }
    const entry: Entry = { tokens: words.map((token) => token.text), block: opens ? [] : null };
    current.push(entry);
    if (entry.block !== null) stack.push(entry.block);
  });
  if (stack.length !== 1) throw new Error('blocco non chiuso alla fine del file');
  return root;
}

function caddyfile(path: string = CADDYFILE): Entry[] {
  return parseCaddyfile(read(path));
}

const nameOf = (entry: Entry): string => entry.tokens[0] ?? '';

function shape(entry: Entry): Shape {
  return { tokens: entry.tokens, block: entry.block === null ? null : entry.block.map(shape) };
}

/** Tutte le righe, a ogni livello. */
function allEntries(entries: Entry[]): Entry[] {
  return entries.flatMap((entry) => [entry, ...allEntries(entry.block ?? [])]);
}

function only(entries: Entry[], name: string): Entry[] {
  return entries.filter((entry) => nameOf(entry) === name);
}

/** Le opzioni del blocco globale: la prima riga del file, una `{` da sola. */
function globalOptions(entries: Entry[]): Entry[] {
  const globals = entries.filter((entry) => entry.tokens.length === 0);
  expect(globals, 'un solo blocco globale').toHaveLength(1);
  expect(entries[0]?.tokens, 'il blocco globale è il primo del file').toEqual([]);
  return entries[0]?.block ?? [];
}

/** I blocchi di sito: le righe del primo livello che non sono il blocco globale. */
function siteBlocks(entries: Entry[]): Entry[] {
  return entries.filter((entry) => entry.tokens.length > 0);
}

/** Le direttive dell'unico blocco di sito. */
function siteDirectives(entries: Entry[] = caddyfile()): Entry[] {
  const sites = siteBlocks(entries);
  expect(sites, 'un solo blocco di sito').toHaveLength(1);
  return sites[0]?.block ?? [];
}

/** Il blocco `log` globale di un Caddyfile. */
function globalLog(path: string): Shape[] {
  return only(globalOptions(caddyfile(path)), 'log').map(shape);
}

// --- Lettura di Dockerfile, versions.env e compose.yml -----------------------------------------------------------------

/** Le istruzioni del Dockerfile di Caddy, con le righe continuate unite, gli spazi ridotti e senza commenti. */
function dockerInstructions(): string[] {
  return read(DOCKERFILE)
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Le fasi del Dockerfile: ogni fase comincia con un FROM. */
function dockerStages(): string[][] {
  const stages: string[][] = [];
  for (const instruction of dockerInstructions()) {
    const stage = stages.at(-1);
    if (/^FROM /i.test(instruction)) stages.push([instruction]);
    else if (stage === undefined) throw new Error(`istruzione prima del primo FROM: ${instruction}`);
    else stage.push(instruction);
  }
  return stages;
}

/** La versione di Caddy della fase finale (`FROM caddy:<x.y.z>`). */
function caddyVersion(): string {
  const from = dockerStages().at(-1)?.[0] ?? '';
  const match = /^FROM caddy:(\d+\.\d+\.\d+)$/i.exec(from);
  expect(match, `FROM caddy:<x.y.z> nella fase finale: ${from}`).not.toBeNull();
  return match?.[1] ?? '';
}

/** Le righe di infra/versions.env che non sono vuote né commenti. */
function versionLines(): string[] {
  return read(VERSIONS)
    .split(/\r?\n/)
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Le righe di infra/compose.yml senza commenti né righe vuote. */
function composeLines(): string[] {
  return read(COMPOSE)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Le righe del blocco `<chiave>:` scritto con `indent` spazi di rientro: quelle che seguono, con un rientro maggiore. */
function yamlBlock(lines: string[], key: string, indent: number): string[] {
  const start = lines.findIndex((line) => line === `${' '.repeat(indent)}${key}:`);
  expect(start, `${key}: con ${indent} spazi di rientro, nella forma a blocco`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && indentOf(line) <= indent);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/**
 * Le opzioni di una rete del primo livello `networks:` di infra/compose.yml (`chiave: valore`), con il valore senza
 * apici e senza un commento in fondo alla riga. Le chiavi hanno anche cifre (enable_ipv6).
 */
function networkOptions(network: string): Record<string, string> {
  const options: Record<string, string> = {};
  for (const line of yamlBlock(yamlBlock(composeLines(), 'networks', 0), network, 2)) {
    const match = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (match?.[1] === undefined) continue;
    options[match[1]] = (match[2] ?? '')
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return options;
}

/** Le porte pubblicate dal servizio caddy di infra/compose.yml, senza apici. */
function caddyPorts(): string[] {
  const caddy = yamlBlock(yamlBlock(composeLines(), 'services', 0), 'caddy', 2);
  return yamlBlock(caddy, 'ports', 4).map((line) => line.replace(/^\s*-\s*/, '').replace(/^['"]|['"]$/g, ''));
}

// --- Test ------------------------------------------------------------------------------------------------------------

describe('Caddyfile dell’immagine Caddy (infra/caddy/Caddyfile)', () => {
  it('06§Caddy: il blocco globale ha solo email {$ACME_EMAIL}, servers e log', () => {
    const options = globalOptions(caddyfile());
    expect(options.map(nameOf).sort()).toEqual(['email', 'log', 'servers']);
    expect(only(options, 'email').map(shape)).toEqual([{ tokens: ['email', '{$ACME_EMAIL}'], block: null }]);
  });

  it('DOM-008: Caddy serve solo HTTP/1.1 e HTTP/2 (servers { protocols h1 h2 }, senza h3) e il servizio caddy pubblica solo 80 e 443 in TCP', () => {
    expect(only(globalOptions(caddyfile()), 'servers').map(shape)).toEqual([
      { tokens: ['servers'], block: [{ tokens: ['protocols', 'h1', 'h2'], block: null }] },
    ]);
    expect(caddyPorts()).toEqual(['80:80/tcp', '443:443/tcp']);
  });

  it('DOM-001: un solo blocco di sito, per {$BASE_DOMAIN} e *.{$BASE_DOMAIN}: la radice e il jolly, nessun certificato per negozio', () => {
    const sites = siteBlocks(caddyfile());
    expect(sites, 'un solo blocco di sito').toHaveLength(1);
    const addresses = (sites[0]?.tokens ?? [])
      .join(' ')
      .split(/[\s,]+/)
      .filter(Boolean);
    expect(addresses).toEqual(['{$BASE_DOMAIN}', '*.{$BASE_DOMAIN}']);
  });

  it('DOM-001: i certificati si ottengono con la sfida DNS di Cloudflare: tls { dns cloudflare {env.CF_API_TOKEN} }', () => {
    expect(only(siteDirectives(), 'tls').map(shape)).toEqual([
      { tokens: ['tls'], block: [{ tokens: ['dns', 'cloudflare', '{env.CF_API_TOKEN}'], block: null }] },
    ]);
  });

  it('DOM-001: nessun certificato a richiesta (on_demand) e nessun altro emittente o modo di emissione', () => {
    const words = allEntries(caddyfile()).flatMap((entry) => entry.tokens);
    expect(words.filter((word) => /^on_demand/.test(word))).toEqual([]);
    const otherIssuance = ['acme_ca', 'acme_ca_root', 'acme_dns', 'acme_eab', 'auto_https', 'cert_issuer', 'issuer'];
    expect(
      words.filter((word) => otherIssuance.includes(word) || word === 'local_certs' || word === 'internal'),
    ).toEqual([]);
  });

  it('06§Caddy: le variabili d’ambiente sono solo {$BASE_DOMAIN} e {$ACME_EMAIL}, senza valori predefiniti, e il token solo {env.CF_API_TOKEN}, nella direttiva dns', () => {
    const text = read(CADDYFILE);
    const words = allEntries(parseCaddyfile(text)).flatMap((entry) => entry.tokens);
    const fileVariables = new Set(words.flatMap((word) => [...word.matchAll(/\{\$([^}:]+)[^}]*\}/g)].map((m) => m[1])));
    expect([...fileVariables].sort()).toEqual(['ACME_EMAIL', 'BASE_DOMAIN']);
    expect(text, 'nessun valore predefinito {$NOME:valore}').not.toMatch(/\{\$[^}]*:/);
    expect(
      words.flatMap((word) => [...word.matchAll(/\{env\.([^}]+)\}/g)].map((m) => m[1])),
      'una sola variabile letta con env., una volta',
    ).toEqual(['CF_API_TOKEN']);
    expect(words.filter((word) => word.includes('CF_API_TOKEN'))).toEqual(['{env.CF_API_TOKEN}']);
    expect(text, 'il token mai nella forma {$CF_API_TOKEN}, nemmeno in un commento').not.toContain('$CF_API_TOKEN');
  });

  it('DOM-009: HSTS max-age=31536000; includeSubDomains su ogni risposta del sito, senza preload', () => {
    const headers = only(siteDirectives(), 'header');
    expect(headers.map((entry) => ({ length: entry.tokens.length, name: entry.tokens[1]?.toLowerCase() }))).toEqual([
      { length: 3, name: 'strict-transport-security' },
    ]);
    expect(headers[0]?.block).toBeNull();
    const value = headers[0]?.tokens[2] ?? '';
    expect(value).toBe('max-age=31536000; includeSubDomains');
    expect(value.toLowerCase()).not.toContain('preload');
  });

  it('06§Caddy: le richieste perdono gli header interni x-middleware-subrequest, x-shop-id e x-nonce, su ogni percorso', () => {
    const removals = only(siteDirectives(), 'request_header');
    expect(removals.every((entry) => entry.tokens.length === 2 && entry.block === null)).toBe(true);
    expect(removals.map((entry) => (entry.tokens[1] ?? '').toLowerCase()).sort()).toEqual([
      '-x-middleware-subrequest',
      '-x-nonce',
      '-x-shop-id',
    ]);
  });

  it('FON-011: /api/webhooks/email sulla radice e su www risponde 403 a chi non viene dagli intervalli dei webhook di Brevo', () => {
    const site = siteDirectives();
    const matchers = only(site, '@email_webhook_foreign');
    expect(matchers.map((entry) => entry.tokens)).toEqual([['@email_webhook_foreign']]);
    const conditions = matchers[0]?.block ?? [];
    expect(conditions.every((entry) => entry.block === null)).toBe(true);
    expect(conditions.map((entry) => entry.tokens.join(' ')).sort()).toEqual([
      'host {$BASE_DOMAIN} www.{$BASE_DOMAIN}',
      `not remote_ip ${BREVO_WEBHOOK_RANGES.join(' ')}`,
      'path /api/webhooks/email',
    ]);
    expect(
      only(site, 'respond')
        .filter((entry) => entry.tokens[1] === '@email_webhook_foreign')
        .map(shape),
    ).toEqual([{ tokens: ['respond', '@email_webhook_foreign', '403'], block: null }]);
  });

  it('06§Caddy: la revisione del repository inoltra all’app (reverse_proxy app:3000) e comprime (encode zstd gzip), senza risposte fisse 200', () => {
    const site = siteDirectives();
    expect(only(site, 'reverse_proxy').map(shape)).toEqual([{ tokens: ['reverse_proxy', 'app:3000'], block: null }]);
    expect(only(site, 'encode').map(shape)).toEqual([{ tokens: ['encode', 'zstd', 'gzip'], block: null }]);
    expect(only(site, 'respond').map((entry) => entry.tokens)).toEqual([['respond', '@email_webhook_foreign', '403']]);
  });

  it('06§Caddy: il sito ha solo le direttive dello schema', () => {
    expect(siteDirectives().map(nameOf).sort()).toEqual(
      [
        '@email_webhook_foreign',
        'encode',
        'header',
        'request_header',
        'request_header',
        'request_header',
        'respond',
        'reverse_proxy',
        'tls',
      ].sort(),
    );
  });

  it('06§DNS: nessun trusted_proxies e niente che tocchi X-Forwarded-For: all’app arriva l’indirizzo vero di chi è collegato', () => {
    const words = allEntries(caddyfile()).flatMap((entry) => entry.tokens);
    const forbidden = ['trusted_proxies', 'trusted_proxies_strict', 'client_ip_headers', 'header_up'];
    expect(words.filter((word) => forbidden.includes(word))).toEqual([]);
    expect(words.filter((word) => /x-forwarded-|x-real-ip/i.test(word))).toEqual([]);
  });
});

describe('registri di Caddy', () => {
  it('00§4.2: il blocco globale log default scrive su stderr in JSON e toglie l’oggetto request (indirizzo, intestazioni, IP)', () => {
    expect(globalLog(CADDYFILE)).toEqual([
      {
        tokens: ['log', 'default'],
        block: [
          { tokens: ['output', 'stderr'], block: null },
          {
            tokens: ['format', 'filter'],
            block: [
              { tokens: ['wrap', 'json'], block: null },
              { tokens: ['request', 'delete'], block: null },
            ],
          },
        ],
      },
    ]);
  });

  it('00§4.2: la prova del filtro (tests/infra/caddy-log) usa lo stesso blocco log default, e il suo controllo è la stessa configurazione senza', () => {
    const production = globalLog(CADDYFILE);
    expect(production).toHaveLength(1);
    expect(globalLog(LOG_TEST)).toEqual(production);
    // Il controllo: la configurazione della prova senza il blocco log (e senza il blocco globale, se resta vuoto).
    const withoutLog = caddyfile(LOG_TEST)
      .map((entry) =>
        entry.tokens.length === 0 ? { ...entry, block: (entry.block ?? []).filter((d) => nameOf(d) !== 'log') } : entry,
      )
      .filter((entry) => entry.tokens.length > 0 || (entry.block ?? []).length > 0);
    expect(caddyfile(LOG_TEST_CONTROL).map(shape)).toEqual(withoutLog.map(shape));
  });
});

describe('Dockerfile dell’immagine Caddy (infra/caddy/Dockerfile)', () => {
  it('06§Caddy: due fasi con la stessa versione fissata di Caddy, caddy:<x.y.z>-builder e caddy:<x.y.z>', () => {
    const stages = dockerStages();
    expect(stages, 'due fasi').toHaveLength(2);
    const builder = /^FROM caddy:(\d+\.\d+\.\d+)-builder AS builder$/i.exec(stages[0]?.[0] ?? '');
    expect(builder, stages[0]?.[0]).not.toBeNull();
    expect(builder?.[1]).toBe(caddyVersion());
  });

  it('DOM-001: xcaddy aggiunge solo il modulo DNS di Cloudflare, fissato a una versione non più vecchia della v0.2.4', () => {
    const builder = dockerStages()[0] ?? [];
    const runs = builder.filter((instruction) => /^RUN /i.test(instruction));
    expect(runs, 'una sola istruzione RUN nella fase builder').toHaveLength(1);
    const run = runs[0] ?? '';
    // Solo --with e il modulo: un argomento in più (una versione di Caddy, un --replace) cambierebbe ciò che si costruisce.
    expect(run).toMatch(/^RUN xcaddy build --with \S+$/);
    const modules = [...run.matchAll(/--with (\S+)/g)].map((m) => m[1] ?? '');
    expect(modules, 'un solo modulo').toHaveLength(1);
    const match = /^github\.com\/caddy-dns\/cloudflare@v(\d+)\.(\d+)\.(\d+)$/.exec(modules[0] ?? '');
    expect(match, `versione fissata vX.Y.Z: ${modules[0]}`).not.toBeNull();
    // Confronto per parti (maggiore, minore, correzione) con 0.2.4: il primo numero diverso decide.
    const version = [1, 2, 3].map((group) => Number(match?.[group] ?? -1));
    const minimum = [0, 2, 4];
    const order = version.reduce((found, part, k) => (found !== 0 ? found : Math.sign(part - (minimum[k] ?? 0))), 0);
    expect(order, `${modules[0]} non più vecchia della v0.2.4`).toBeGreaterThanOrEqual(0);
    expect(builder.slice(1), 'nella fase builder solo FROM e RUN').toEqual([run]);
  });

  it('06§Caddy: la fase finale copia il caddy costruito e il Caddyfile, e ha la label del repository; nient’altro', () => {
    const final = dockerStages()[1] ?? [];
    expect(final.slice(1).sort()).toEqual(
      [
        'COPY --from=builder /usr/bin/caddy /usr/bin/caddy',
        'COPY Caddyfile /etc/caddy/Caddyfile',
        'LABEL org.opencontainers.image.source="https://github.com/jinoesfoo/gestionale-negozi"',
      ].sort(),
    );
  });
});

describe('infra/versions.env', () => {
  it('06§Compiti: ogni riga è NOME=valore, senza apici né spazi, oppure un commento #; ogni nome una volta (nota (2) del piano di DOM-T02)', () => {
    const lines = versionLines();
    for (const line of lines) expect(line).toMatch(/^[A-Z][A-Z0-9_]*=[^\s'"#]+$/);
    const names = lines.map((line) => line.split('=')[0]);
    expect(new Set(names).size, 'nomi ripetuti').toBe(names.length);
  });

  it('01§Servizi: CADDY_TAG è la versione di Caddy del Dockerfile, un trattino e il numero di revisione', () => {
    const tags = versionLines().filter((line) => line.startsWith('CADDY_TAG='));
    expect(tags).toHaveLength(1);
    const match = /^CADDY_TAG=(\d+\.\d+\.\d+)-([1-9]\d*)$/.exec(tags[0] ?? '');
    expect(match, tags[0]).not.toBeNull();
    expect(match?.[1]).toBe(caddyVersion());
  });

  it('06§Compiti: CADDY_TAG non è 2.11.9-1, il tag dell’immagine di avvio con la risposta fissa (nota (1) del piano di DOM-T02)', () => {
    // Con il tag di avvio, FON-T07b e i rilasci di FON-T08 rimetterebbero davanti all'app la risposta fissa. Le revisioni
    // successive (2.11.9-3, 2.12.0-1, …) passano senza cambiare questo test.
    expect(versionLines().filter((line) => line.startsWith('CADDY_TAG='))).not.toContain('CADDY_TAG=2.11.9-1');
    expect(versionLines().filter((line) => line.startsWith('CADDY_TAG='))).toHaveLength(1);
  });
});

describe('rete di Caddy in infra/compose.yml', () => {
  it('06§DNS: la rete edge ha IPv6 (enable_ipv6: true), così a Caddy arriva l’indirizzo vero dei client IPv6; la rete internal resta solo IPv4', () => {
    expect(networkOptions('edge')).toMatchObject({ enable_ipv6: 'true' });
    expect(networkOptions('internal').enable_ipv6 ?? 'false').toBe('false');
  });
});
