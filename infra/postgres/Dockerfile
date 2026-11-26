# Immagine PostgreSQL del progetto (01 §Servizi e §Inizializzazione del database, FON-T03), con pgBackRest per
# l'archiviazione dei WAL e i backup (08 §pgBackRest, OPS-T01a). La costruisce la CI per test e produzione
# (ghcr.io/<utente>/<repo>-postgres, tag per versione: infra/versions.env, POSTGRES_TAG); in sviluppo la costruisce
# compose.dev.yml, che spegne l'archiviazione.
FROM postgres:18.7-trixie

# GitHub collega il pacchetto al repository solo se la label c'è alla prima pubblicazione (01 §Servizi).
LABEL org.opencontainers.image.source="https://github.com/jinoesfoo/gestionale-negozi"

# pgBackRest; jq, che legge l'uscita JSON di `pgbackrest info` (pgbackrest-summary); i certificati delle autorità, che
# l'immagine ufficiale non ha: senza, pgBackRest non verifica il certificato del bucket. Nessuna versione fissata (08,
# note del piano di OPS-T01a, «Pacchetti»): una revisione fissata sparirebbe dall'indice di Debian al primo
# aggiornamento e romperebbe la costruzione da zero; i server usano l'immagine pubblicata, fissata dal digest, e le
# versioni installate si annotano a ogni pubblicazione (infra/README.md, «PostgreSQL e backup»). Il pacchetto installa
# anche un file d'esempio, /etc/pgbackrest.conf, che pgBackRest leggerebbe se mancasse quello vero: si toglie.
RUN apt-get update \
  && apt-get install -y --no-install-recommends pgbackrest jq ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/pgbackrest.conf

# Configurazione di pgBackRest con le sole opzioni uguali su tutti i server: endpoint, bucket, regione, chiavi e
# repo1-cipher-pass pgBackRest li legge dalle variabili PGBACKREST_* di postgres.env, che vincono sul file (08, note
# del piano di OPS-T01a, «Configurazione»). Nessun ENV PGBACKREST_* nell'immagine: vincerebbe anche sul --config dei
# ripristini con un file scritto a mano.
COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
# Il riassunto di `pgbackrest info` (usato da pgbackrest-init, da infra/scripts/backup.sh e dalla prova del bucket sui
# server) e il comando del servizio Compose una tantum pgbackrest-init (08, note del piano, «Script nell'immagine»).
COPY --chmod=755 pgbackrest-summary pgbackrest-init /usr/local/bin/

# Configurazione copiata nell'immagine, non montata: una modifica produce una nuova versione dell'immagine.
COPY postgresql.conf /etc/postgresql/postgresql.conf
# Modello dei ruoli per infra/postgres/init/01-roles.sh (ROLES_TEMPLATE, predefinito /opt/roles.sql.tpl).
COPY roles.sql.tpl /opt/roles.sql.tpl

# Su 127.0.0.1 risponde solo il server definitivo: quello provvisorio dell'inizializzazione ascolta solo sul socket,
# quindi il servizio diventa healthy dopo 01-roles.sh. Forma exec, senza shell, e pg_isready che si arrende (-t 5)
# prima che Docker interrompa il controllo (--timeout=10s): con la forma shell, Docker che uccide sh a controllo
# scaduto lascia pg_isready orfano, il processo passa al PID 1 del container, cioè a PostgreSQL, e PostgreSQL 18,
# quando esce, lo tratta come un suo processo terminato male e riavvia tutto in recupero (successo in FON-T03,
# all'avvio su un disco lento). Utente e database sono i valori fissi di POSTGRES_USER e POSTGRES_DB (01 §Variabili
# d'ambiente).
HEALTHCHECK --interval=5s --timeout=10s --start-period=120s --retries=12 \
  CMD ["pg_isready", "-q", "-t", "5", "-h", "127.0.0.1", "-U", "postgres", "-d", "app"]

CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
