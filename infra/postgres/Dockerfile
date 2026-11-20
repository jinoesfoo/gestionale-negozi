# Immagine PostgreSQL del progetto (01 §Servizi e §Inizializzazione del database, FON-T03). La costruisce la CI per
# test e produzione (ghcr.io/<utente>/<repo>-postgres, tag per versione); in sviluppo la costruisce compose.dev.yml.
# pgBackRest e l'archiviazione dei WAL arrivano con OPS-T01a.
FROM postgres:18.7-trixie

# GitHub collega il pacchetto al repository solo se la label c'è alla prima pubblicazione (01 §Servizi).
LABEL org.opencontainers.image.source="https://github.com/jinoesfoo/gestionale-negozi"

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
