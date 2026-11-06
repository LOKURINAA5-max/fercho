#!/usr/bin/env bash
# Copia de seguridad diaria. Programar con cron: 0 2 * * * cd /ruta/proyecto && ./scripts/backup.sh
# Guarda también una copia FUERA del servidor (otro disco, nube) o no sirve si se pierde el servidor.
set -euo pipefail
URL="${DATABASE_URL_ADMIN:-${DATABASE_URL:?Define DATABASE_URL}}"
mkdir -p backups
pg_dump "$URL" -Fc -f "backups/fercho_$(date +%F).dump"
find backups -name 'fercho_*.dump' -mtime +30 -delete
echo "Copia lista: backups/fercho_$(date +%F).dump"
