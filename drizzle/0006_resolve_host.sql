-- resolve_host: il negozio di un host <sottodominio>.{{DOMINIO}}, per il proxy (02 §Funzioni di piattaforma e
-- §Instradamento per host, punto 5; NEG-T02, nota (4) del piano). Riceve l'host intero e confronta con
-- shops.subdomain la sua prima etichetta, in minuscolo, solo se l'host contiene un punto. Il database non conosce
-- PUBLIC_BASE_DOMAIN: il controllo del dominio lo fa resolveHost() (src/server/db/resolve-host.ts), che tiene anche la
-- cache. Restituisce il negozio qualunque sia lo stato (anche closed: il 404 del sito lo decide il proxy) e anche se
-- is_test. SECURITY DEFINER di app_owner, search_path fisso, eseguibile solo da app_user (U).
CREATE FUNCTION public.resolve_host(p_host text)
  RETURNS TABLE (shop_id uuid, subdomain text, shop_status text, name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT s.id, s.subdomain, s.status, s.name
      FROM public.shops AS s
     WHERE strpos(p_host, '.') > 0
       AND s.subdomain = split_part(lower(p_host), '.', 1)
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.resolve_host(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.resolve_host(text) TO app_user;
