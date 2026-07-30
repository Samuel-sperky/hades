#!/usr/bin/env sh
# Izolovaná testovacia databáza pre jeden bežiaci agent / vlnu.
#
# Prečo to existuje: `RefreshDatabase` migruje na začiatku každého testu, takže dva
# paralelné behy `php artisan test` nad tou istou schémou si navzájom rozbijú migrácie
# ("Base table or view already exists"). Pri vlne agentov to znamená desiatky falošných
# pádov, ktoré maskujú skutočné regresie. Každý bežec preto dostane vlastnú schému.
#
# Použitie (z hostiteľa, v koreni projektu):
#   sh scripts/test-db.sh p1                    # vytvor/resetuj auraai_test_p1
#   docker compose exec -T -e DB_DATABASE=auraai_test_p1 app php artisan test
#
# Heslo roota sa nikdy neobjaví v argv ani vo výstupe — čítame ho vnútri kontajnera
# z jeho vlastnej env premennej.
set -eu

SUFFIX="${1:-}"
if [ -z "$SUFFIX" ]; then
    echo "použitie: sh scripts/test-db.sh <sufix>   (napr. p1, p7, int)" >&2
    exit 2
fi

DB="auraai_test_${SUFFIX}"
CONTAINER="${MARIADB_CONTAINER:-auraai-mariadb-1}"
APP_USER="${DB_USERNAME:-auraai}"

docker exec "$CONTAINER" sh -c '
    set -eu
    DB="$1"; APP_USER="$2"
    : "${MARIADB_ROOT_PASSWORD:?root password not present in container env}"
    MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot --batch --skip-column-names -e "
        DROP DATABASE IF EXISTS \`${DB}\`;
        CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        GRANT ALL PRIVILEGES ON \`${DB}\`.* TO '\''${APP_USER}'\''@'\''%'\'';
        FLUSH PRIVILEGES;
    "
' _ "$DB" "$APP_USER"

echo "pripravená schéma ${DB}"
echo "spusti:  docker compose exec -T -e DB_DATABASE=${DB} app php artisan test"
