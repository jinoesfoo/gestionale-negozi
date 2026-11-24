// Schema Drizzle del database (tabelle di public), un file per tabella; drizzle-kit (drizzle.config.ts) genera le
// migrazioni da qui. RLS, policy, permessi e funzioni stanno nelle migrazioni scritte a mano (00 §6).
export * from './audit-log';
export * from './email-suppressions';
export * from './platform-config';
export * from './shop-secrets';
export * from './shops';
