import { inspect } from 'node:util';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';
import { DbError, dbErrorCode, toDbError } from '@/server/db/errors';

// 00 §4.2 e 02 NEG-T02, nota (2) del piano: un errore del database esce da withShop, withUser e withNewShop come
// DbError, con codice SQLSTATE, nomi di vincolo, tabella, colonna e schema e un messaggio senza valori. Il
// DrizzleQueryError di drizzle-orm mette nel messaggio il testo della query e i parametri (dati personali), e l'errore
// di PostgreSQL in `cause`; il filtro beforeSend di Sentry (08) toglie solo email e sequenze di 4–6 cifre.

const QUERY = 'insert into "shops" ("name", "subdomain", "tax_code") values ($1, $2, $3)';
const PARAMS = ['Mario Rossi Segreto', 'negozio-segreto', 'RSSMRA80A01H501U'];
const DETAIL = 'Key (subdomain)=(negozio-segreto) already exists.';
// Campi che pg copia sull'errore (pg-protocol, parseErrorMessage) e che DbError non porta mai (nota (2) del piano). Sono
// gettoni su una sola riga: util.inspect spezza le stringhe lunghe con a capo.
const HINT = 'Controlla valore-hint-segreto.';
const WHERE = 'PL/pgSQL function f() line 7 at SQL statement valore-where-segreto';
const INTERNAL_QUERY = "SELECT id FROM public.shops WHERE name = 'valore-query-interna-segreto'";
const PG_ONLY = ['valore-hint-segreto', 'valore-where-segreto', 'valore-query-interna-segreto'];
const ALLOWED_KEYS = ['name', 'message', 'stack', 'code', 'constraint', 'table', 'column', 'schema'];

interface PgFields {
  code: string;
  message: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
  detail?: string;
}

/**
 * Il DatabaseError di pg come lo costruisce il driver (pg-protocol: messaggio di PostgreSQL, poi i campi), sempre con
 * hint, where e internalQuery che contengono valori.
 */
function pgError({ message, ...fields }: PgFields): Error {
  return Object.assign(
    new DatabaseError(message, 0, 'error'),
    { severity: 'ERROR', hint: HINT, where: WHERE, internalQuery: INTERNAL_QUERY },
    fields,
  );
}

/** DbError porta solo codice, nomi e messaggio: nessun altro campo con un valore. */
function expectOnlyAllowedKeys(error: unknown): void {
  for (const [key, value] of Object.entries(error as object)) {
    if (value !== undefined) expect(ALLOWED_KEYS, key).toContain(key);
  }
}

/** L'errore come lo solleva drizzle-orm 0.45.4 quando la query fallisce (pg-core/session.js, queryWithCache). */
function wrapped(cause: Error): DrizzleQueryError {
  return new DrizzleQueryError(QUERY, PARAMS, cause);
}

/** Nessun valore della query nella rappresentazione completa dell'errore (quella che finisce nei log). */
function expectNoValues(error: unknown): void {
  const text = inspect(error, { depth: null });
  for (const value of [...PARAMS, QUERY, 'Failed query', 'params:', DETAIL, 'Failing row contains', ...PG_ONLY]) {
    expect(text).not.toContain(value);
  }
}

describe('toDbError', () => {
  it('00§4.2: un errore di vincolo avvolto da Drizzle diventa un DbError con codice e nomi, senza query, parametri, detail né cause', () => {
    const error = toDbError(
      wrapped(
        pgError({
          code: '23505',
          message: 'duplicate key value violates unique constraint "shops_subdomain_unique"',
          constraint: 'shops_subdomain_unique',
          table: 'shops',
          column: 'subdomain',
          schema: 'public',
          detail: DETAIL,
        }),
      ),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({
      name: 'DbError',
      code: '23505',
      constraint: 'shops_subdomain_unique',
      table: 'shops',
      column: 'subdomain',
      schema: 'public',
      message: 'duplicate key value violates unique constraint "shops_subdomain_unique"',
    });
    expect((error as DbError).cause).toBeUndefined();
    expect(Object.keys(error as object)).not.toContain('detail');
    expectOnlyAllowedKeys(error);
    expectNoValues(error);
  });

  it('00§4.2: per le classi il cui messaggio contiene solo nomi resta il messaggio di PostgreSQL', () => {
    const cases: [code: string, message: string][] = [
      ['23502', 'null value in column "name" of relation "shops" violates not-null constraint'],
      [
        '23503',
        'insert or update on table "audit_log" violates foreign key constraint "audit_log_shop_id_shops_id_fk"',
      ],
      ['23514', 'new row for relation "audit_log" violates check constraint "audit_log_actor_type_check"'],
      ['42501', 'permission denied for table audit_log'],
      ['42501', 'new row violates row-level security policy for table "audit_log"'],
      ['25006', 'cannot execute UPDATE in a read-only transaction'],
      ['40001', 'could not serialize access due to concurrent update'],
      ['40P01', 'deadlock detected'],
      ['57014', 'canceling statement due to statement timeout'],
      ['P0001', "admin_create_shop: manca l'utente del contesto (app.user_id)."],
    ];
    for (const [code, message] of cases) {
      const error = toDbError(wrapped(pgError({ code, message, detail: DETAIL })));
      expect(error, code).toBeInstanceOf(DbError);
      expect(error, code).toMatchObject({ code, message });
      expectOnlyAllowedKeys(error);
      expectNoValues(error);
    }
  });

  it('00§4.2: per le altre classi il messaggio è generico, perché quello di PostgreSQL può contenere il valore', () => {
    const cases: [code: string, message: string][] = [
      ['22P02', 'invalid input syntax for type uuid: "Mario Rossi Segreto"'],
      ['22001', 'value too long for type character varying(5)'],
      ['08006', 'connection failure'],
      ['53300', 'sorry, too many clients already'],
    ];
    for (const [code, message] of cases) {
      const error = toDbError(wrapped(pgError({ code, message })));
      expect(error, code).toBeInstanceOf(DbError);
      expect(error, code).toMatchObject({ code, message: `Errore del database (codice ${code}).` });
      expectOnlyAllowedKeys(error);
      expectNoValues(error);
    }
  });

  it('00§4.2: un errore di pg non avvolto da Drizzle diventa allo stesso modo un DbError', () => {
    const error = toDbError(
      pgError({ code: '42501', message: 'permission denied for table audit_log', table: 'audit_log', detail: DETAIL }),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({
      code: '42501',
      table: 'audit_log',
      message: 'permission denied for table audit_log',
    });
    expectOnlyAllowedKeys(error);
    expectNoValues(error);
  });

  it('00§4.2: un DrizzleQueryError che avvolge un errore senza codice SQLSTATE (connessione persa, proxy revocato) diventa l’errore avvolto', () => {
    const lost = new Error('Connection terminated unexpectedly');
    const revoked = new TypeError("Cannot perform 'get' on a proxy that has been revoked");
    const errno = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    // Un codice di sistema di 5 lettere maiuscole, come uno SQLSTATE, ma senza cifre: non è un errore di PostgreSQL.
    const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE', errno: -32, syscall: 'write' });
    for (const cause of [lost, revoked, errno, epipe]) {
      const error = toDbError(wrapped(cause));
      expect(error, cause.message).toBe(cause);
      expectNoValues(error);
    }
  });

  it('00§4.2: gli errori dell’applicazione e gli altri valori passano invariati', () => {
    const appError = new Error('errore applicativo');
    expect(toDbError(appError)).toBe(appError);
    const typeError = new TypeError('tipo sbagliato');
    expect(toDbError(typeError)).toBe(typeError);
    expect(toDbError('stringa')).toBe('stringa');
    expect(toDbError(undefined)).toBeUndefined();
  });
});

describe('dbErrorCode', () => {
  it('00§4.2: legge il codice SQLSTATE da DbError, da DrizzleQueryError e da un errore di pg; altrimenti undefined', () => {
    const constraint = pgError({ code: '23505', message: 'duplicate key value violates unique constraint "x"' });
    expect(dbErrorCode(toDbError(wrapped(constraint)))).toBe('23505');
    expect(dbErrorCode(wrapped(constraint))).toBe('23505');
    expect(dbErrorCode(pgError({ code: '42501', message: 'permission denied for table audit_log' }))).toBe('42501');
    expect(dbErrorCode(new Error('errore applicativo'))).toBeUndefined();
    expect(dbErrorCode(wrapped(new Error('Connection terminated unexpectedly')))).toBeUndefined();
    expect(dbErrorCode(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBeUndefined();
    expect(dbErrorCode(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBeUndefined();
    expect(dbErrorCode(wrapped(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })))).toBeUndefined();
    expect(dbErrorCode('stringa')).toBeUndefined();
  });
});
