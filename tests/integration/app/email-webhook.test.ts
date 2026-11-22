import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/webhooks/email/route';
import { closeDb } from '@/server/db/client';
import { stopAppBoss } from '@/server/jobs/app-boss';
import { closeRolePools, rolePool } from '../../fixtures/db';

// FON-011 con la route vera e il database vero (01 FON-T10). La route gira con il client dell'app (DATABASE_URL =
// TEST_DATABASE_APP_URL, ruolo app_user) e l'istanza pg-boss dell'app (DATABASE_JOBS_URL, app_jobs); i controlli
// leggono con il proprietario (email_suppressions, audit_log) e con app_jobs (pgboss.job). Ogni prova usa un indirizzo
// suo, su un dominio riservato ai test, e alla fine si tolgono le righe e i lavori di questo file.
//
// Accettazione: una chiamata senza token o con token errato risponde 403 e non scrive nulla; dopo una chiamata valida
// l'indirizzo è in email_suppressions (in minuscolo), con una riga `email_suppressed` di piattaforma (shop_id nullo,
// scritta da audit_platform) e un avviso accodato ad ADMIN_ALERT_EMAIL; una seconda chiamata valida con lo stesso
// indirizzo risponde 200 e non lascia una seconda riga, una seconda riga di registro o un secondo avviso.

const DOMAIN = 'fon-t10-webhook.example.com';

const address = (tag: string) => `${tag}-${randomUUID()}@${DOMAIN}`;

function token(): string {
  const value = process.env.EMAIL_WEBHOOK_TOKEN;
  if (value === undefined || value === '') throw new Error('Manca EMAIL_WEBHOOK_TOKEN in .env.test.');
  return value;
}

function adminAlertEmail(): string {
  const value = process.env.ADMIN_ALERT_EMAIL;
  if (value === undefined || value === '') throw new Error('Manca ADMIN_ALERT_EMAIL in .env.test.');
  return value;
}

async function call(body: unknown, k: string | null = token()): Promise<Response> {
  const url = new URL('http://localhost:3000/api/webhooks/email');
  if (k !== null) url.searchParams.set('k', k);
  return POST(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

const event = (type: string, email: string) => ({ event: type, email, date: '2026-11-21 10:00:00', ts_event: 1 });

async function suppressions(email: string) {
  const result = await rolePool('owner').query<{ email: string; reason: string }>(
    'SELECT email, reason FROM public.email_suppressions WHERE email = lower($1)',
    [email],
  );
  return result.rows;
}

async function auditRows(email: string) {
  const result = await rolePool('owner').query<{
    shop_id: string | null;
    actor_type: string;
    actor_user_id: string | null;
    object_id: string;
  }>(
    `SELECT shop_id, actor_type, actor_user_id, object_id FROM public.audit_log
      WHERE action = 'email_suppressed' AND object_id = lower($1)`,
    [email],
  );
  return result.rows;
}

async function alertJobs(email: string) {
  const result = await rolePool('jobs').query<{ data: { to: string; template: string; data: { email: string } } }>(
    `SELECT data FROM pgboss.job WHERE name = 'email.send' AND data->'data'->>'email' = lower($1)`,
    [email],
  );
  return result.rows.map((row) => row.data);
}

afterAll(async () => {
  const pattern = `%@${DOMAIN}`;
  await rolePool('owner').query('DELETE FROM public.email_suppressions WHERE email LIKE $1', [pattern]);
  await rolePool('owner').query(
    "DELETE FROM public.audit_log WHERE action = 'email_suppressed' AND object_id LIKE $1",
    [pattern],
  );
  await rolePool('jobs').query("DELETE FROM pgboss.job WHERE name = 'email.send' AND data->'data'->>'email' LIKE $1", [
    pattern,
  ]);
  await stopAppBoss();
  await closeDb();
  await closeRolePools();
});

describe('POST /api/webhooks/email con il database vero', () => {
  it('FON-011: senza token risponde 403 e non scrive nulla', async () => {
    const email = address('senza-token');
    const response = await call(event('hard_bounce', email), null);
    expect(response.status).toBe(403);
    expect(await suppressions(email)).toEqual([]);
    expect(await auditRows(email)).toEqual([]);
    expect(await alertJobs(email)).toEqual([]);
  });

  it('FON-011: con un token errato risponde 403 e non scrive nulla', async () => {
    const email = address('token-errato');
    const wrong = token().slice(0, -1) + (token().endsWith('a') ? 'b' : 'a');
    for (const k of [wrong, 'corto']) {
      const response = await call(event('hard_bounce', email), k);
      expect(response.status, k).toBe(403);
    }
    expect(await suppressions(email)).toEqual([]);
    expect(await auditRows(email)).toEqual([]);
  });

  it('FON-011: una segnalazione valida registra l’indirizzo in minuscolo, la riga email_suppressed di piattaforma e un avviso', async () => {
    const email = address('Rimbalzo');
    const response = await call(event('hard_bounce', email.toUpperCase()));
    expect(response.status).toBe(200);

    expect(await suppressions(email)).toEqual([{ email: email.toLowerCase(), reason: 'bounce' }]);

    const audit = await auditRows(email);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ shop_id: null, actor_type: 'system', object_id: email.toLowerCase() });

    const alerts = await alertJobs(email);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      to: adminAlertEmail(),
      template: 'email-suppressed',
      data: { email: email.toLowerCase(), reason: 'bounce' },
    });
  });

  it('FON-011: una seconda segnalazione dello stesso indirizzo risponde 200 senza una seconda riga, registro o avviso', async () => {
    const email = address('ripetuto');
    expect((await call(event('hard_bounce', email))).status).toBe(200);
    expect((await call(event('spam', email))).status).toBe(200);

    expect(await suppressions(email)).toEqual([{ email, reason: 'bounce' }]);
    expect(await auditRows(email)).toHaveLength(1);
    expect(await alertJobs(email)).toHaveLength(1);
  });

  it('FON-011: spam si registra come complaint e blocked come bounce', async () => {
    const spam = address('spam');
    const blocked = address('bloccato');
    expect((await call(event('spam', spam))).status).toBe(200);
    expect((await call(event('blocked', blocked))).status).toBe(200);
    expect(await suppressions(spam)).toEqual([{ email: spam, reason: 'complaint' }]);
    expect(await suppressions(blocked)).toEqual([{ email: blocked, reason: 'bounce' }]);
  });

  it('FON-011: un evento che non è un rimbalzo né una segnalazione risponde 200 senza effetti', async () => {
    const email = address('consegnato');
    expect((await call(event('delivered', email))).status).toBe(200);
    expect(await suppressions(email)).toEqual([]);
    expect(await alertJobs(email)).toEqual([]);
  });

  it('FON-011: un elenco di eventi registra ogni rimbalzo e ogni segnalazione', async () => {
    const first = address('gruppo-uno');
    const second = address('gruppo-due');
    const response = await call([
      event('hard_bounce', first),
      event('opened', address('aperto')),
      event('spam', second),
    ]);
    expect(response.status).toBe(200);
    expect(await suppressions(first)).toEqual([{ email: first, reason: 'bounce' }]);
    expect(await suppressions(second)).toEqual([{ email: second, reason: 'complaint' }]);
  });

  it('FON-011: un corpo che non è JSON risponde 400', async () => {
    expect((await call('{non è json')).status).toBe(400);
  });
});
