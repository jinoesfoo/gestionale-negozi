import { describe, expect, it } from 'vitest';
import { EXPORT_EXCLUDED_COLUMNS, exportableColumns } from '@/server/exports/redact';

// Colonne escluse dall'esportazione dei dati del negozio (02 NEG-014; 08 §Esportazione e OPS-032; NEG-T09, nota (5)
// del piano). L'elenco sta in src/server/exports/redact.ts, che nasce in NEG-T09 con le due colonne di 08: il testo
// cifrato dei segreti (shop_secrets.ciphertext) e l'hash del token degli inviti (invitations.token_hash, tabella che
// nasce in ACC-T06). exports.build (OPS-T08) costruirà l'elenco del SELECT di ogni tabella con exportableColumns, così
// una colonna esclusa non si legge nemmeno; l'esportazione intera si prova in OPS-T08 (OPS-032, collaudo C16).

const SHOP_SECRETS_COLUMNS = ['id', 'shop_id', 'name', 'ciphertext', 'created_at', 'rotated_at'];

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
});
