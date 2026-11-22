-- Permessi, RLS e funzione di piattaforma del registro e delle esclusioni dalle email (01 FON-T10; 08 §Registro;
-- 02 §Policy standard e §Funzioni di piattaforma; 00 R-DATI-4: REVOKE ALL prima dei GRANT, per entrambi i ruoli).

-- audit_log: tabella di negozio (shop_id nullo = riga di piattaforma, invisibile ad app_user e app_worker).
REVOKE ALL ON public.audit_log FROM app_user, app_worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.audit_log TO app_user, app_worker;
--> statement-breakpoint
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shop_isolation ON public.audit_log
  USING (shop_id = public.app_shop_id())
  WITH CHECK (shop_id = public.app_shop_id());
--> statement-breakpoint

-- email_suppressions: tabella di piattaforma. app_user inserisce dal webhook (senza lettura: ON CONFLICT DO NOTHING
-- senza colonna), app_worker legge prima di ogni email.send.
REVOKE ALL ON public.email_suppressions FROM app_user, app_worker;
--> statement-breakpoint
GRANT INSERT ON public.email_suppressions TO app_user;
--> statement-breakpoint
GRANT SELECT ON public.email_suppressions TO app_worker;
--> statement-breakpoint

-- audit_platform: riga di registro di piattaforma (shop_id nullo), che app_user e app_worker non possono inserire da
-- sé sotto la policy standard. SECURITY DEFINER di app_owner (BYPASSRLS), search_path fisso, eseguibile solo da U e W.
CREATE FUNCTION public.audit_platform(
  p_actor_type text,
  p_actor_user_id text,
  p_action text,
  p_object_type text,
  p_object_id text,
  p_before jsonb,
  p_after jsonb,
  p_ip inet,
  p_user_agent text
) RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    INSERT INTO public.audit_log
      (shop_id, actor_type, actor_user_id, action, object_type, object_id, before, after, ip, user_agent)
    VALUES
      (NULL, p_actor_type, p_actor_user_id, p_action, p_object_type, p_object_id, p_before, p_after, p_ip, p_user_agent)
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.audit_platform(text, text, text, text, text, jsonb, jsonb, inet, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.audit_platform(text, text, text, text, text, jsonb, jsonb, inet, text)
  TO app_user, app_worker;
