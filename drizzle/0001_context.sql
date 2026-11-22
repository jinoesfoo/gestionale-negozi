-- Funzioni di contesto (02 §Funzioni di contesto, 01 FON-T10): le usa la policy standard delle tabelle di negozio,
-- a partire da audit_log; NEG-T01 le trova già create. NULLIF: dopo una transazione con set_config(..., true) la
-- variabile resta definita come stringa vuota sulla connessione riutilizzata. Proprietario app_owner (le migrazioni
-- girano con il suo ruolo); i privilegi predefiniti tolgono già EXECUTE a PUBLIC, qui lo si scrive comunque.
CREATE FUNCTION public.app_shop_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.shop_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION public.app_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.app_shop_id(), public.app_user_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_shop_id(), public.app_user_id() TO app_user, app_worker;
