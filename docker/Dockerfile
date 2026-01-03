FROM oven/bun:latest

WORKDIR /app

COPY . .

RUN bun install

EXPOSE 14123

CMD [ "bun", "start" ]