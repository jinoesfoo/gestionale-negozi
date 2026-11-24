# Immagine Caddy con il modulo DNS di Cloudflare (06 §Caddy, DOM-T02). Le versioni sono fissate: Caddy nelle due righe
# FROM, con lo stesso numero, e il modulo nella riga di xcaddy (non più vecchio della v0.2.4, la prima che accetta i
# token di Cloudflare nel formato nuovo). Ogni modifica di questa cartella è una revisione nuova dell'immagine
# (infra/versions.env).
FROM caddy:2.11.9-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare@v0.2.4

FROM caddy:2.11.9
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
LABEL org.opencontainers.image.source="https://github.com/jinoesfoo/gestionale-negozi"
