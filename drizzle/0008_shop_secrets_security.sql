-- RLS e permessi dei segreti per negozio (02 §Segreti per negozio e §Policy standard, NEG-012, NEG-014; NEG-T09,
-- nota (2) del piano; 00 R-DATI-4: REVOKE ALL prima dei GRANT, per entrambi i ruoli). La tabella nasce nella migrazione
-- generata 0007, applicata nella stessa transazione (nota (19) di 01): nessun momento la vede con i permessi
-- predefiniti di roles.sql.tpl (SELECT, INSERT, UPDATE e DELETE ad app_user e app_worker).

-- app_user legge, inserisce e cancella i segreti del negozio del contesto, e aggiorna solo il testo cifrato e la data
-- della rotazione; app_worker li legge soltanto (modulo cassa, e già in fase 0 exports.build, sulle colonne senza
-- ciphertext: 08 §Esportazione).
REVOKE ALL ON public.shop_secrets FROM app_user, app_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.shop_secrets TO app_user;
--> statement-breakpoint
GRANT UPDATE (ciphertext, rotated_at) ON public.shop_secrets TO app_user;
--> statement-breakpoint
GRANT SELECT ON public.shop_secrets TO app_worker;
--> statement-breakpoint
ALTER TABLE public.shop_secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.shop_secrets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shop_isolation ON public.shop_secrets
  USING (shop_id = public.app_shop_id())
  WITH CHECK (shop_id = public.app_shop_id());
