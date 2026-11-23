// Negozi (02 §Tabella `shops`, NEG-001, NEG-T01). Le colonne `suspended_at` e `failure_reminder_sent_at` arrivano in
// BIL-T02 (area 05). RLS con la policy standard su `id`, permessi (NEG-009: app_user SELECT e UPDATE delle sole colonne
// dei dati del negozio; app_worker solo SELECT) e niente scritture dirette sulle colonne di stato (R-DATI-5) stanno
// nella migrazione scritta a mano (00 §6). Vincoli della nota (3) del piano di NEG-T01.
import { sql } from 'drizzle-orm';
import { boolean, check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Indirizzo del negozio; il paese predefinito `IT` lo scrive l'app, il database controlla solo che sia un oggetto. */
export interface ShopAddress {
  street?: string;
  city?: string;
  zip?: string;
  province?: string;
  country?: string;
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const shops = pgTable(
  'shops',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    vatNumber: text('vat_number'),
    taxCode: text('tax_code'),
    sdiCode: text('sdi_code'),
    pec: text('pec'),
    address: jsonb('address').$type<ShopAddress>(),
    subdomain: text('subdomain').notNull().unique('shops_subdomain_unique'),
    status: text('status').notNull().default('trial'),
    statusChangedAt: timestamptz('status_changed_at').notNull().defaultNow(),
    graceStartedAt: timestamptz('grace_started_at'),
    closedAt: timestamptz('closed_at'),
    reopenedAt: timestamptz('reopened_at'),
    trialInactivityWarnedAt: timestamptz('trial_inactivity_warned_at'),
    isTest: boolean('is_test').notNull().default(false),
    purgeRequestedAt: timestamptz('purge_requested_at'),
    purgeNoticeSentAt: timestamptz('purge_notice_sent_at'),
    lastActivityAt: timestamptz('last_activity_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  () => [
    check('shops_name_length_check', sql`char_length(name) BETWEEN 2 AND 120`),
    check('shops_vat_number_check', sql`vat_number ~ '^[0-9]{11}$'`),
    check('shops_tax_code_check', sql`tax_code ~ '^[A-Z0-9]{16}$' OR tax_code ~ '^[0-9]{11}$'`),
    // `0000000` è ammesso: destinatario senza codice, che riceve via PEC o nel cassetto fiscale.
    check('shops_sdi_code_check', sql`sdi_code ~ '^[A-Z0-9]{7}$'`),
    check('shops_pec_check', sql`pec = lower(pec) AND pec ~ '^[^@[:space:]]+@[^@[:space:]]+$'`),
    check('shops_address_check', sql`jsonb_typeof(address) = 'object'`),
    // NEG-001: [a-z0-9-]{3,40}, senza `-` iniziale o finale.
    check('shops_subdomain_format_check', sql`subdomain ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'`),
    // Gli stessi valori di platform.reservedSubdomains (src/config/platform.ts): il test di NEG-001 prova che ognuno
    // di quelli del file è rifiutato, quindi una voce aggiunta al file senza una migrazione lo fa fallire.
    check(
      'shops_subdomain_reserved_check',
      sql`subdomain NOT IN ('admin', 'app', 'clienti', 'www', 'api', 'mail', 'status', 'test', 'static', 'cdn', 'n')`,
    ),
    check(
      'shops_status_check',
      sql`status IN ('trial', 'active', 'payment_processing', 'payment_failed', 'suspended', 'closed')`,
    ),
  ],
);
