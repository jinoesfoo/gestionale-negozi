# Immagine dell'app (01 §Contenuto dell'immagine dell'app, FON-T06): una sola immagine per `app` (`node server.js`,
# output standalone di Next.js), `worker` (`node dist/worker.js`) e `migrate` (`node dist/migrate.js`, e il CLI
# `node dist/cli.js`). Contiene anche la cartella infra/ del commit in /opt/infra, che deploy.sh estrae a ogni
# rilascio (FON-T08). Nessun segreto: le variabili arrivano dai file di /srv/app/env/ (Compose, env_file).
#
#   docker build --build-arg APP_VERSION=<sha del commit> -t <nome>:<tag> .
#
# Il contesto è a elenco chiuso (.dockerignore): solo i file che servono alla build.

# --- Base comune delle fasi di build: Node della versione delle postazioni (.nvmrc) e pnpm di packageManager. Il
# pacchetto pnpm 12 diventa il comando vero con il suo script di installazione, che npm esegue solo se ammesso
# (--allow-scripts). Questa fase non finisce nell'immagine: la cache di npm può restare.
FROM node:24.22.3-trixie-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --allow-scripts=pnpm pnpm@12.18.0
WORKDIR /build

# --- Dipendenze, in una fase a parte: si rifà solo quando cambiano package.json o il lockfile.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- Build: Next.js (output standalone) e i quattro punti di ingresso con tsup (dist/).
FROM deps AS build
COPY . .
RUN pnpm build && pnpm build:dist

# --- Immagine finale: niente pnpm né sorgenti, solo ciò che serve a eseguire. Nessun modulo nativo da installare: i
# file di dist/ contengono già tutte le loro dipendenze (tsup.config.ts).
FROM node:24.22.3-trixie-slim AS runtime
# GitHub collega il pacchetto al repository solo se la label c'è alla prima pubblicazione (01 §Servizi Docker Compose).
LABEL org.opencontainers.image.source="https://github.com/jinoesfoo/gestionale-negozi"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Il server di Next.js ascolta su tutte le interfacce del container, porta 3000 (Docker imposterebbe HOSTNAME al nome
# del container).
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

# server.js, package.json ("type": "module", vale anche per dist/), node_modules dell'app web e .next del server.
# Di proprietà di node: Next.js scrive la sua cache in .next/cache.
COPY --from=build --chown=node:node /build/.next/standalone ./
COPY --from=build --chown=node:node /build/.next/static ./.next/static
COPY --from=build /build/dist ./dist
# Le migrazioni: dist/migrate.js le cerca in ../drizzle, cioè /app/drizzle.
COPY drizzle ./drizzle
# La cartella infra/ del commit (la stessa del contesto, copiata nella fase di build), che deploy.sh estrae.
COPY --from=build /build/infra /opt/infra

# La versione del commit, letta da /api/health (FON-009) e dal controllo di deploy.sh: senza, la build fallisce.
ARG APP_VERSION
RUN test -n "$APP_VERSION" || { echo "Manca --build-arg APP_VERSION (lo SHA del commit)." >&2; exit 1; }
ENV APP_VERSION=$APP_VERSION

USER node
EXPOSE 3000
CMD ["node", "server.js"]
