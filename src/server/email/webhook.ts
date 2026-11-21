// Webhook dei rimbalzi di Brevo (FON-011, 01 FON-T10): POST /api/webhooks/email?k=<EMAIL_WEBHOOK_TOKEN>. Brevo non
// firma le chiamate (esito del [VERIFICA] nel piano di FON-T10): il token nella query, confrontato a tempo costante, è
// il primo livello; il secondo è l'elenco IP di Brevo nel Caddyfile (06 §Caddy). Senza token o con un token sbagliato
// risponde 403 e non scrive nulla. Eventi (nota (1) del piano): `hard_bounce` → bounce, `spam` → complaint, `blocked`
// → bounce; gli altri ricevono 200 senza effetti. Il corpo può essere un evento o un elenco di eventi. L'avviso ad
// ADMIN_ALERT_EMAIL si accoda solo se la riga è nuova, dopo il commit; se l'accodamento fallisce l'esclusione resta,
// l'avviso si perde e il log lo dice senza l'indirizzo (nota (5)). Se la registrazione fallisce risponde 500, così
// Brevo riprova.
import { createHash, timingSafeEqual } from 'node:crypto';
import { isPlaceholder } from '@/config/env';
import { errorMessage } from '@/lib/errors';

export type SuppressionReason = 'bounce' | 'complaint';

export interface EmailWebhookDeps {
  /** EMAIL_WEBHOOK_TOKEN; vuoto o ancora segnaposto (`placeholder…`), ogni chiamata è rifiutata. */
  token: string;
  /** Registra l'esclusione (e la riga di registro, nella stessa transazione); vero se la riga è nuova. */
  record(email: string, reason: SuppressionReason): Promise<boolean>;
  /** Accoda l'avviso ad ADMIN_ALERT_EMAIL. */
  alert(email: string, reason: SuppressionReason): Promise<void>;
}

const REASONS: Readonly<Record<string, SuppressionReason>> = {
  hard_bounce: 'bounce',
  spam: 'complaint',
  blocked: 'bounce',
};

/**
 * Confronto a tempo costante: si confrontano le impronte, che hanno sempre la stessa lunghezza. Un token atteso vuoto o
 * ancora segnaposto non protegge nulla (il segnaposto sta negli esempi): ogni chiamata è rifiutata (nota (16) di 01).
 */
function tokenMatches(given: string | null, expected: string): boolean {
  if (given === null || given === '' || expected === '' || isPlaceholder(expected)) return false;
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** L'indirizzo in minuscolo, oppure undefined se non sembra un indirizzo email. */
function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = value.trim().toLowerCase();
  const at = email.indexOf('@');
  if (email.length > 320 || /\s/.test(email)) return undefined;
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1) return undefined;
  return email;
}

/** Il messaggio d'errore per il log, senza l'indirizzo. */
function withoutAddress(error: unknown, email: string): string {
  return errorMessage(error).split(email).join('<indirizzo>');
}

export async function handleEmailWebhook(request: Request, deps: EmailWebhookDeps): Promise<Response> {
  if (!tokenMatches(new URL(request.url).searchParams.get('k'), deps.token)) {
    return new Response(null, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Corpo della richiesta non valido: serve JSON.' }, { status: 400 });
  }
  const events: unknown[] = Array.isArray(body) ? body : [body];
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue;
    const { event: type, email } = event as { event?: unknown; email?: unknown };
    if (typeof type !== 'string' || !Object.hasOwn(REASONS, type)) continue;
    const reason = REASONS[type]!;
    const address = normalizeEmail(email);
    if (address === undefined) continue;

    let isNew: boolean;
    try {
      isNew = await deps.record(address, reason);
    } catch (error) {
      console.error(`Webhook delle email: esclusione non registrata (${withoutAddress(error, address)}).`);
      return new Response(null, { status: 500 });
    }
    if (!isNew) continue;
    try {
      await deps.alert(address, reason);
    } catch (error) {
      console.error(
        'Webhook delle email: esclusione registrata, ma avviso ad ADMIN_ALERT_EMAIL non accodato ' +
          `(${withoutAddress(error, address)}).`,
      );
    }
  }
  return Response.json({ ok: true });
}
