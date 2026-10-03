# Packages a binary that was already compiled on the host / in CI:
#
#   bun run compile linux-x64-baseline --no-version-tag
#   docker build -f docker/Dockerfile -t delivr-api .
#
# To build everything inside Docker instead, use docker/Dockerfile.build.

FROM debian:stable-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1000 delivr \
    && useradd --system --uid 1000 --gid delivr --home-dir /opt/delivr-api --shell /usr/sbin/nologin delivr

WORKDIR /opt/delivr-api

COPY ./build/bin/delivr-api-linux-x64-baseline /usr/local/bin/delivr-api
# Migrations are read from disk at startup (DLA_DB_AUTO_MIGRATE), relative to the working directory
COPY ./drizzle/migrations ./drizzle/migrations

RUN chmod 755 /usr/local/bin/delivr-api \
    && mkdir -p data config \
    && chown -R delivr:delivr /opt/delivr-api

# Docker networks are IPv4-only by default, so binding "::" would fail
ENV DLA_API_HOST=0.0.0.0 \
    DLA_API_PORT=14123 \
    DLA_DB_CONNECTION_URL=/opt/delivr-api/data/db.sqlite \
    DLA_LOG_DIR=/opt/delivr-api/data/logs \
    DLA_CONFIG_BASE_DIR=/opt/delivr-api/config

VOLUME ["/opt/delivr-api/data", "/opt/delivr-api/config"]

USER delivr

EXPOSE 14123/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${DLA_API_PORT}/health" > /dev/null || exit 1

ENTRYPOINT ["delivr-api"]
