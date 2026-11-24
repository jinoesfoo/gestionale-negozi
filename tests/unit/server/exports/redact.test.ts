import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { EXPORT_EXCLUDED_COLUMNS, exportableColumns } from '@/server/exports/redact';

// Colonne escluse dall'esportazione dei dati del negozio (02 NEG-014; 08 §Esportazione e OPS-032; NEG-T09, nota (5)
// del piano). L'elenco sta in src/server/exports/redact.ts, che nasce in NEG-T09 con le due colonne di 08: il testo
// cifrato dei segreti (shop_secrets.ciphertext) e l'hash del token degli inviti (invitations.token_hash, tabella che
// nasce in ACC-T06). exports.build (OPS-T08) costruirà l'elenco del SELECT di ogni tabella con exportableColumns, così
// una colonna esclusa non si legge nemmeno; l'esportazione intera si prova in OPS-T08 (OPS-032, collaudo C16). Nota
// della revisione di NEG-T09: tabella e colonne si passano con il nome semplice, come relname e attname del catalogo;
// un nome in un'altra forma (con lo schema, fra virgolette) non troverebbe la sua voce e lascerebbe passare la colonna
// esclusa, quindi exportableColumns lo rifiuta con un errore dal messaggio fisso, che non riporta il nome.

const SHOP_SECRETS_COLUMNS = ['id', 'shop_id', 'name', 'ciphertext', 'created_at', 'rotated_at'];
const BAD_NAME = 'Nome di tabella o di colonna non valido per l’esportazione: serve il nome semplice del catalogo.';

function errorOf(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error('La chiamata doveva fallire.');
}

describe('colonne escluse dall’esportazione', () => {
  it('NEG-014: l’elenco è esattamente ciphertext di shop_secrets e token_hash di invitations', () => {
    expect(EXPORT_EXCLUDED_COLUMNS).toEqual({ invitations: ['token_hash'], shop_secrets: ['ciphertext'] });
  });

  it('NEG-014: exportableColumns toglie ciphertext dalle colonne di shop_secrets e tiene l’ordine delle altre', () => {
    expect(exportableColumns('shop_secrets', SHOP_SECRETS_COLUMNS)).toEqual([
      'id',
      'shop_id',
      'name',
      'created_at',
      'rotated_at',
    ]);
    expect(exportableColumns('invitations', ['id', 'shop_id', 'email', 'token_hash', 'expires_at'])).toEqual([
      'id',
      'shop_id',
      'email',
      'expires_at',
    ]);
  });

  it('NEG-014: l’esclusione vale per tabella: le altre tabelle si esportano intere, anche con una colonna dallo stesso nome', () => {
    expect(exportableColumns('audit_log', ['id', 'shop_id', 'ciphertext', 'token_hash'])).toEqual([
      'id',
      'shop_id',
      'ciphertext',
      'token_hash',
    ]);
    expect(exportableColumns('shops', [])).toEqual([]);
    // L'elenco ricevuto non cambia.
    const columns = [...SHOP_SECRETS_COLUMNS];
    exportableColumns('shop_secrets', columns);
    expect(columns).toEqual(SHOP_SECRETS_COLUMNS);
  });

  it('NEG-014: un nome di tabella o di colonna che non è il nome semplice del catalogo (con lo schema, fra virgolette, con spazi o vuoto) è rifiutato con un messaggio fisso, senza lasciar passare la colonna esclusa', () => {
    const badTables = ['public.shop_secrets', '"shop_secrets"', 'shop secrets', 'shop_secrets;', '', '9tabella'];
    for (const table of badTables) {
      const error = errorOf(() => exportableColumns(table, SHOP_SECRETS_COLUMNS));
      expect(error, table).toBeInstanceOf(Error);
      expect((error as Error).message, table).toBe(BAD_NAME);
      if (table !== '') expect(inspect(error), table).not.toContain(table);
    }
    // Le colonne si controllano per ogni tabella, con una voce in EXPORT_EXCLUDED_COLUMNS o senza.
    const badColumns = ['"ciphertext"', 'shop_secrets.ciphertext', 'cipher text', ''];
    for (const table of ['shop_secrets', 'audit_log']) {
      for (const column of badColumns) {
        const error = errorOf(() => exportableColumns(table, ['id', column]));
        expect(error, `${table}: ${column}`).toBeInstanceOf(Error);
        expect((error as Error).message, `${table}: ${column}`).toBe(BAD_NAME);
        if (column !== '') expect(inspect(error), `${table}: ${column}`).not.toContain(column);
      }
    }
    // I nomi semplici passano, anche con maiuscole e cifre (attname e relname come li scrive il catalogo).
    expect(exportableColumns('shop_secrets_2', ['id', 'userId', '_x9'])).toEqual(['id', 'userId', '_x9']);
    expect(exportableColumns('twoFactor', ['id'])).toEqual(['id']);
  });
});
