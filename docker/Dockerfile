FROM oven/bun:latest

FROM debian:stable-slim

RUN apt-get update && apt-get install -y ca-certificates openssl

WORKDIR /opt/delivr-api

COPY ./build/bin/delivr-api-linux-x64-baseline /usr/local/bin/delivr-api

RUN chmod u+x /usr/local/bin/delivr-api

EXPOSE 14123/tcp

ENTRYPOINT ["delivr-api"]