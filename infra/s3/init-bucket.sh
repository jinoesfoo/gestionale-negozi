#!/bin/sh
# Prepara il bucket dell'emulatore S3 di compose.dev.yml (FON-T03): lo crea se manca e ne attiva il versioning, poi
# stampa lo stato del versioning e fallisce se non è Enabled. Gira a ogni `up` nel servizio s3-init (stessa immagine
# di SeaweedFS), con i comandi di `weed shell` letti dallo standard input; la seconda volta trova il bucket e
# riconferma il versioning. Variabili: S3_BUCKET, WEED_MASTER e WEED_FILER (indirizzi del servizio s3).
set -eu

BUCKET="${S3_BUCKET:?manca S3_BUCKET}"
MASTER="${WEED_MASTER:?manca WEED_MASTER}"
FILER="${WEED_FILER:?manca WEED_FILER}"
WAIT_ATTEMPTS=30

weed_shell() {
  printf '%s\n' "$1" | weed shell -master="$MASTER" -filer="$FILER" -connectTimeout=5s
}

# Aspetta che master e filer rispondano (l'avvio di mini richiede qualche secondo).
attempt=1
until buckets="$(weed_shell 's3.bucket.list' 2>&1)"; do
  if [ "$attempt" -ge "$WAIT_ATTEMPTS" ]; then
    printf '%s\n' "$buckets" >&2
    echo "ERRORE: l'emulatore S3 non risponde dopo $WAIT_ATTEMPTS tentativi" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

# s3.bucket.list scrive una riga per bucket: due spazi, il nome, una tabulazione.
if printf '%s\n' "$buckets" | grep -q "^  $BUCKET	"; then
  echo "Il bucket $BUCKET esiste già."
else
  weed_shell "s3.bucket.create -name $BUCKET"
fi

weed_shell "s3.bucket.versioning -name $BUCKET -enable"
status="$(weed_shell "s3.bucket.versioning -name $BUCKET")"
printf '%s\n' "$status"
if ! printf '%s\n' "$status" | grep -qx 'Versioning: Enabled'; then
  echo "ERRORE: il versioning del bucket $BUCKET non è Enabled" >&2
  exit 1
fi
