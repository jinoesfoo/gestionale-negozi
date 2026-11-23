import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { DatabaseError } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DbError } from '@/server/db/errors';

// Esclusioni dalle email (FON-011, 01 FON-T10) allineate a NEG-T02, nota (13) del ritorno al piano: recordEmailSuppression
// ascolta 'error' sul client finché non lo rilascia e lo distrugge dopo un errore della connessione o un ROLLBACK
// fallito; recordEmailSuppression e isEmailSuppressed fanno uscire i loro errori come DbError (00 §4.2), senza il
// `detail` di pg, che contiene l'indirizzo. Prove senza database, con il pool di client.ts sostituito da uno finto.

const state = vi.hoisted(() => ({ pool: undefined as unknown }));
vi.mock('@/server/db/client', () => ({ getPool: () => state.pool }));

const EMAIL = 'mario.rossi@example.com';

afterEach(() => {
  state.pool = undefined;
});

function pgError(code: string, message: string, fields: Record<string, string> = {}): Error {
  return Object.assign(new DatabaseError(message, 0, 'error'), { severity: 'ERROR', code, ...fields });
}

/** Un client finto che è un EventEmitter vero, come quello di pg: senza ascoltatori `emit('error')` lancia. */
function emitterClient(respond: (text: string, emitter: EventEmitter) => unknown) {
  const emitter = new EventEmitter();
  const recorded: string[] = [];
  const client = Object.assign(emitter, {
    query: vi.fn(async (text: string) => {
      recorded.push(text);
      const custom = await respond(text, emitter);
      return custom ?? { rows: [], rowCount: text.startsWith('INSERT') ? 1 : 0, command: 'SELECT', fields: [] };
    }),
    release: vi.fn(),
    getTransactionStatus: vi.fn(() => 'I'),
  });
  return { client, recorded };
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('la promessa doveva fallire');
}

describe('recordEmailSuppression', () => {
  it('FON-011: l’evento error della connessione fra BEGIN e INSERT non termina il processo, e il client si rilascia con un errore', async () => {
    const lost = new Error('Connection terminated unexpectedly');
    const notQueryable = new Error('Client has encountered a connection error and is not queryable');
    let threw = false;
    const { client } = emitterClient((text, emitter) => {
      if (text.startsWith('INSERT')) {
        try {
          emitter.emit('error', lost);
        } catch {
          threw = true;
        }
        throw lost;
      }
      if (text === 'ROLLBACK') throw notQueryable;
      return undefined;
    });
    state.pool = { connect: vi.fn(async () => client) };
    const { recordEmailSuppression } = await import('@/server/db/email-suppressions');

    const error = await errorOf(recordEmailSuppression(EMAIL, 'bounce'));
    expect(threw).toBe(false);
    expect(error).toBeInstanceOf(Error);
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('00§4.2: un errore di pg con detail esce come DbError senza l’indirizzo, e il client torna al pool dopo il ROLLBACK', async () => {
    const check = pgError(
      '23514',
      'new row for relation "email_suppressions" violates check constraint "email_suppressions_reason_check"',
      {
        constraint: 'email_suppressions_reason_check',
        table: 'email_suppressions',
        detail: `Failing row contains (${EMAIL}, bounce, 2026-11-23).`,
      },
    );
    const { client, recorded } = emitterClient((text) => {
      if (text.startsWith('INSERT')) throw check;
      return undefined;
    });
    state.pool = { connect: vi.fn(async () => client) };
    const { recordEmailSuppression } = await import('@/server/db/email-suppressions');

    const error = await errorOf(recordEmailSuppression(EMAIL, 'bounce'));
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '23514', constraint: 'email_suppressions_reason_check' });
    expect(inspect(error, { depth: null })).not.toContain(EMAIL);
    expect(recorded.at(-1)).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBeFalsy();
    expect(client.listenerCount('error')).toBe(0);
  });
});

describe('isEmailSuppressed', () => {
  it('00§4.2: un errore di pg esce come DbError senza l’indirizzo', async () => {
    const denied = pgError('42501', 'permission denied for table email_suppressions', {
      table: 'email_suppressions',
      detail: `Key (email)=(${EMAIL}).`,
      where: `SQL statement with ${EMAIL}`,
    });
    state.pool = {
      query: vi.fn(async () => {
        throw denied;
      }),
    };
    const { isEmailSuppressed } = await import('@/server/db/email-suppressions');

    const error = await errorOf(isEmailSuppressed(EMAIL));
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: '42501', table: 'email_suppressions' });
    expect(inspect(error, { depth: null })).not.toContain(EMAIL);
  });
});
