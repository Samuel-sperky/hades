FROM php:8.4-cli

# ripgrep nesie tool `grep` v konzole vedomia — hľadanie naprieč .md súbormi
# a kódom beží v kontejneri, nie na hoste (na hoste rg nie je vôbec).
RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip libzip-dev mariadb-client ripgrep \
    && docker-php-ext-install pdo_mysql zip pcntl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html
