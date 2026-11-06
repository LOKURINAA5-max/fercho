#!/usr/bin/env bash
# Prueba que la última copia SÍ se puede restaurar: la carga en una base temporal y cuenta filas.
# Hazlo cada mes. Requiere DATABASE_URL_ADMIN con forma postgres://usuario:clave@host:5432/fercho (sin parámetros).
set -euo pipefail
: "${DATABASE_URL_ADMIN:?Define DATABASE_URL_ADMIN}"
ULT=$(ls -t backups/fercho_*.dump | head -1)
BASE="${DATABASE_URL_ADMIN%/*}"; TMP=fercho_prueba_restore
psql "$DATABASE_URL_ADMIN" -q -c "DROP DATABASE IF EXISTS $TMP" -c "CREATE DATABASE $TMP"
pg_restore -d "$BASE/$TMP" --no-owner "$ULT"
echo "Restauración de $ULT:"
psql "$BASE/$TMP" -tA -c "select 'pedidos', count(*) from pedidos union all select 'usuarios', count(*) from usuarios union all select 'turnos', count(*) from turnos_caja"
psql "$DATABASE_URL_ADMIN" -q -c "DROP DATABASE $TMP"
echo "OK: la copia se puede restaurar."
