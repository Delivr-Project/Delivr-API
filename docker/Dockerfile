FROM debian:stable-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/delivr/api

COPY ./build/bin/delivr-api-linux-x64-baseline /opt/delivr/api/app/delivr-api
COPY ./drizzle/migrations ./app/drizzle/migrations

RUN chmod u+x /opt/delivr/api/app/delivr-api

EXPOSE 14123/tcp

ENV NODE_ENV=production

ENV DLA_API_HOST=::
ENV DLA_API_PORT=14123

ENV DLA_DB_CONNECTION_URL=/opt/delivr/api/data/db.sqlite
ENV DLA_DB_AUTO_MIGRATE=true
ENV DLA_DB_MIGRATION_DIR=drizzle/migrations/sqlite

ENV DLA_LOG_DIR=/opt/delivr/api/data/logs
ENV DLA_CONFIG_BASE_DIR=/opt/delivr/api/config

VOLUME /opt/delivr/api/data
VOLUME /opt/delivr/api/config

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
	CMD curl -f http://localhost:14123/health || exit 1

ENTRYPOINT ["/opt/delivr/api/app/delivr-api"]