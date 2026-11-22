-- RLS, permessi e funzione di piattaforma dei negozi e di platform_config (02 NEG-T01, note (4) e (5) del piano;
-- 02 §Policy standard, §Permessi su `shops` e §Funzioni di piattaforma; 00 R-DATI-4: REVOKE ALL prima dei GRANT, per
-- entrambi i ruoli). Le tabelle nascono nella migrazione generata 0004, applicata nella stessa transazione (nota (19)
-- di 01).

-- shops: la colonna del negozio è `id`. app_user e app_worker leggono il negozio del contesto; app_user modifica solo
-- i dati del negozio (NEG-009); le colonne di stato le scrivono solo le funzioni di piattaforma (R-DATI-5).
REVOKE ALL ON public.shops FROM app_user, app_worker;
--> statement-breakpoint
GRANT SELECT ON public.shops TO app_user, app_worker;
--> statement-breakpoint
GRANT UPDATE (name, legal_name, vat_number, tax_code, sdi_code, pec, address) ON public.shops TO app_user;
--> statement-breakpoint
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.shops FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shop_isolation ON public.shops
  USING (id = public.app_shop_id())
  WITH CHECK (id = public.app_shop_id());
--> statement-breakpoint

-- platform_config: tabella di piattaforma, nessun permesso ai ruoli di runtime; la scrive app_owner (src/migrate.ts).
REVOKE ALL ON public.platform_config FROM app_user, app_worker;
--> statement-breakpoint

-- platform_config_get: le coppie chiave-valore in sola lettura, per il worker e per le pagine (U, W). SECURITY DEFINER
-- di app_owner, search_path fisso, eseguibile solo da app_user e app_worker.
CREATE FUNCTION public.platform_config_get()
  RETURNS TABLE (key text, value jsonb)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT c.key, c.value FROM public.platform_config AS c ORDER BY c.key
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.platform_config_get() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.platform_config_get() TO app_user, app_worker;
