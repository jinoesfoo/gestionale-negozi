# Prova del contesto della build (FON-T06, docs/verifiche/fon-t06.md): elenca i file che Docker riceve dalla radice
# del progetto con il .dockerignore vero, senza mostrarne il contenuto. Si lancia dalla radice del progetto:
#
#   docker build --no-cache --progress=plain -f tests/fixtures/docker-context.Dockerfile .
#
# Nessuna immagine con nome: la prova lascia solo la cache di costruzione.
FROM node:24.22.3-trixie-slim
COPY . /contesto
# Il primo livello del contesto.
RUN ls -A1 /contesto
# Tutti i file il cui nome inizia con .env, a ogni profondità: l'elenco atteso è vuoto.
RUN find /contesto -name '.env*' -print; echo "fine dell'elenco dei file .env*"
# Le cartelle che non devono esserci, a ogni profondità: l'elenco atteso è vuoto.
RUN find /contesto \( -name .git -o -name node_modules -o -name .next -o -name .auth -o -name .claude -o -name registro \) -print; echo "fine dell'elenco delle cartelle escluse"
