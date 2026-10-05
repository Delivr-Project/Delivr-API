# The binaries are compiled beforehand (`bun compile all <version> --no-version-tag`).
# Each stage holds one platform's binary, and BuildKit only builds the one that
# TARGETARCH (amd64 / arm64, set per platform by `--platform`) selects.
FROM scratch AS binary-amd64
COPY ./build/bin/delivr-api-linux-x64-baseline /delivr-api

FROM scratch AS binary-arm64
COPY ./build/bin/delivr-api-linux-arm64 /delivr-api

FROM binary-${TARGETARCH} AS binary

FROM debian:stable-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/delivr/api

COPY --from=binary --chmod=755 /delivr-api /opt/delivr/api/app/delivr-api

EXPOSE 14123/tcp

ENV NODE_ENV=production

ENV DLA_API_HOST=::
ENV DLA_API_PORT=14123

ENV DLA_DB_CONNECTION_URL=/opt/delivr/api/data/db.sqlite
ENV DLA_DB_AUTO_MIGRATE=true
ENV DLA_DB_MIGRATION_DIR=sqlite

ENV DLA_LOG_DIR=/opt/delivr/api/data/logs
ENV DLA_CONFIG_BASE_DIR=/opt/delivr/api/config

VOLUME /opt/delivr/api/data
VOLUME /opt/delivr/api/config

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
	CMD curl -f http://localhost:14123/health || exit 1

ENTRYPOINT ["/opt/delivr/api/app/delivr-api"]
