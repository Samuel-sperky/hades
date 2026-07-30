FROM php:8.4-cli

# Node prišiel s vlnou W0: Vite build step bol dovtedy mŕtvy kód (vite.config.js
# existoval, ale v image nebol node ani npm, takže public/build/ nikdy nevzniklo
# a appka ťahala d3 + pusher-js z CDN). Bez buildu sa frontend nedá modularizovať
# ani prevádzkovať offline.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip libzip-dev mariadb-client \
    && docker-php-ext-install pdo_mysql zip pcntl \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Assets are NOT baked into the image on purpose: docker-compose bind-mounts the
# project over /var/www/html, so anything COPYed here would be shadowed at runtime.
# public/build/ is produced from the host or inside the container before serving:
#
#   docker compose exec -T app npm ci
#   docker compose exec -T app npm run build
#
# The app fails loudly (Vite manifest not found) if this step is skipped, so a
# missing build can never be mistaken for a working deploy. See CLAUDE.md.
