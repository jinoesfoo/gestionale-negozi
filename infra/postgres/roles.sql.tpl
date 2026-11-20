-- Ruoli e permessi di base del database app (01 §Inizializzazione del database, 00 §6). Modello per psql, eseguito da
-- infra/postgres/init/01-roles.sh con le password nelle variabili di psql (-v): non è un file .sql, perché
-- l'entrypoint dell'immagine eseguirebbe da sé un .sql di /docker-entrypoint-initdb.d, senza variabili.
CREATE ROLE app_owner LOGIN BYPASSRLS PASSWORD :'owner_password';
CREATE ROLE app_user  LOGIN NOBYPASSRLS PASSWORD :'user_password';
CREATE ROLE app_worker LOGIN NOBYPASSRLS PASSWORD :'worker_password';
CREATE ROLE app_jobs  LOGIN NOBYPASSRLS PASSWORD :'jobs_password';
GRANT CONNECT ON DATABASE app TO app_owner, app_user, app_worker, app_jobs;
GRANT CREATE ON DATABASE app TO app_owner;              -- schema "drizzle" delle migrazioni
GRANT CREATE ON DATABASE app TO app_jobs;               -- pg-boss crea da sé lo schema "pgboss"
-- search_path fisso per ogni ruolo: impedisce che uno schema creato con il nome di un ruolo
-- (il percorso predefinito è "$user", public) faccia trovare oggetti "esca" al posto di quelli veri (CVE-2018-1058)
ALTER ROLE app_owner  SET search_path = public;
ALTER ROLE app_user   SET search_path = public;
ALTER ROLE app_worker SET search_path = public;
ALTER ROLE app_jobs   SET search_path = pgboss;
ALTER SCHEMA public OWNER TO app_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_user, app_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user, app_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
