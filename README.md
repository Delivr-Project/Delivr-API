<div align="center">

<img src="https://raw.githubusercontent.com/Delivr-Project/Delivr-Web/main/public/static/logo/logo.svg" alt="Delivr" height="56" />

# Delivr API

### A Mail Client that actually Delivers

The backend that powers Delivr — a fast, self-hostable mail service built on Bun & Hono,
speaking IMAP and SMTP so your inbox stays yours.

<br />

[![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)](https://bun.sh)
[![Hono](https://img.shields.io/badge/Hono-4.x-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![License](https://img.shields.io/badge/License-AGPL--3.0-00bcff)](./LICENSE)

[**Web Client →**](https://github.com/Delivr-Project/Delivr-Web) &nbsp;•&nbsp; [Features](#-features) &nbsp;•&nbsp; [Quick Start](#-quick-start) &nbsp;•&nbsp; [Configuration](#️-configuration)

</div>

---

## ✨ Features

- 📬 **Real mail, real protocols** — connects to any IMAP/SMTP provider via [`imapflow`](https://github.com/postalsys/imapflow) and [`nodemailer`](https://nodemailer.com); nothing proprietary in the way.
- 🗂️ **Nested mail resources** — mail accounts → mailboxes → mails → attachments, modelled cleanly all the way down.
- 📎 **Privacy-first attachments** — content is **never stored or cached** server-side. Attachments are re-fetched from IMAP, parsed in-memory, and streamed out with `Cache-Control: no-store`.
- ⚡ **Bulk mail actions** — move, copy, delete, and flag many messages in one request.
- 🖼️ **BIMI brand logos** — resolves sender brand logos from DNS for use as profile pictures; only record metadata is read, the logo is never fetched or stored.
- 🔐 **JWT auth + API keys** — token-based sessions plus scoped API keys for programmatic access.
- 🔒 **ECC crypto** — mail-backend credentials protected with elliptic-curve encryption and signing.
- 📖 **First-class OpenAPI** — every route is documented via `hono-openapi` and browsable through an embedded [Scalar](https://scalar.com) reference.
- 🗄️ **Bring your own database** — SQLite out of the box, with PostgreSQL and MySQL fully supported through Drizzle.
- ⏰ **Scheduled tasks** — background jobs via the `cron` package.
- ✅ **Integration-tested** — a mock IMAP/SMTP harness exercises the real request paths.

## 🧱 Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | **Bun 1.x** |
| Framework | **Hono 4.x** |
| Language | **TypeScript 6.x** |
| ORM | **Drizzle ORM** + Drizzle Kit |
| Validation | **Zod 4.x** + `@hono/standard-validator` |
| API Docs | `hono-openapi` + `@scalar/hono-api-reference` |
| Database | SQLite · PostgreSQL · MySQL |
| Mail | `imapflow` (IMAP) · `nodemailer` (SMTP) · `postal-mime` |
| Crypto | `elliptic` (ECC) |

## 🚀 Quick Start

> **Prerequisites:** [Bun](https://bun.sh) 1.x

```bash
# 1. Install dependencies
bun install

# 2. Configure your environment
cp example.env .env
#    → set DLA_ENCRYPTION_KEY (32 characters) and review the rest

# 3. Run database migrations (SQLite by default)
bun run db:sqlite:migrate

# 4. Start the dev server
bun run dev
```

The API is now live at **http://localhost:14123**, with the interactive [Scalar](https://scalar.com) reference at **`/docs/v1`** and the raw OpenAPI spec at **`/docs/v1/openapi`** (unless `DLA_DISABLE_DOCS=true`). The root path `/` redirects to the latest version's docs.

## 🐳 Docker

The easiest way to get Delivr running is Docker Compose. It starts the API and the web client together, using the ready-made images from GitHub, so you don't have to install Bun or build anything yourself.

All you need is this repository (or just the `docker-compose.yml` and `example.docker.env` from it):

```bash
cp example.docker.env .env
docker compose up -d
```

Before you start, open `.env` and set `DLA_ENCRYPTION_KEY`. It needs to be exactly 32 characters; `openssl rand -hex 16` gives you one. Keep it safe: it encrypts the stored mail account passwords, and if you lose it, those accounts have to be added again.

Once it's up, open **http://localhost:14128**. On first start the API creates an `admin` account for you. Run `docker compose logs api` to find the link where you set its password.

To update later, run `docker compose pull && docker compose up -d`. Your data stays where it is.

Prefer to build the images yourself? Clone [Delivr-Web](https://github.com/Delivr-Project/Delivr-Web) into a folder next to this one and use `docker compose up -d --build`.

If you want to run Delivr on a server, set `DELIVR_API_PUBLIC_URL` and `DELIVR_APP_PUBLIC_URL` in `.env` to the addresses your browser will actually use, e.g. `https://api.example.com` and `https://mail.example.com`.

### Running just the API

```bash
docker run -d -p 14123:14123 \
  -e DLA_APP_URL=http://localhost:14128 \
  -e DLA_ENCRYPTION_KEY=your-32-character-encryption-key \
  -v delivr-api-data:/opt/delivr-api/data \
  -v delivr-api-config:/opt/delivr-api/config \
  ghcr.io/delivr-project/delivr-api:latest
```

Images are tagged with the version (e.g. `:0.8.0`) and `:latest`. If you'd rather build it yourself, `docker build -f docker/Dockerfile.build -t delivr-api .` does the job.

Your data lives in two volumes: `data` holds the SQLite database and logs, `config` holds generated files like the initial admin link. As long as you keep those volumes, you can update or recreate the container without losing anything. Database migrations run automatically on startup.

A few things worth knowing:

- The container runs as a regular user (`delivr`, UID 1000), not as root. If you mount folders from your host instead of using volumes, make sure that user can write to them.
- There's a health check at `/health`, so `docker ps` shows whether the API is actually up.
- `docker/Dockerfile.build` builds everything from source and works on both x86 and ARM. `docker/Dockerfile` only packages a binary you've already built with `bun run compile linux-x64-baseline --no-version-tag`.

## ⚙️ Configuration

All configuration is environment-based (see [`example.env`](./example.env)):

| Variable | Description | Default |
|----------|-------------|---------|
| `DLA_LOG_LEVEL` | Log verbosity | `info` |
| `DLA_APP_URL` | **Required.** URL of the Delivr web client | — |
| `DLA_API_HOST` | Bind address | `::` |
| `DLA_API_PORT` | Listen port | `14123` |
| `DLA_DISABLE_DOCS` | Disable the Scalar API reference | `false` |
| `DLA_ENCRYPTION_KEY` | **Required. 32-character** key for credential encryption | — |
| `DLA_DB_CONNECTION_URL` | Database connection string / path | `./data/db.sqlite` |
| `DLA_DB_AUTO_MIGRATE` | Run migrations on startup | `true` |
| `DLA_LOG_DIR` | Log output directory | `./data/logs` |
| `DLA_CONFIG_BASE_DIR` | Config base directory | `./config` |
| `DLA_SMTP_HOST` | Outbound SMTP host for system mail (e.g. password-reset emails) | — |
| `DLA_SMTP_PORT` | Outbound SMTP port | — |
| `DLA_SMTP_USERNAME` | Outbound SMTP username | — |
| `DLA_SMTP_PASSWORD` | Outbound SMTP password | — |
| `DLA_SMTP_FROM` | `From` address for system mail | — |
| `DLA_SMTP_SECURE` | Use TLS for the SMTP connection | `false` |

## 🛠️ Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server with watch mode |
| `bun run typecheck` | Run TypeScript type checking |
| `bun test` | Run the test suite |
| `bun run compile` | Compile the project |
| `bun run start` | Production entry point |
| `bun run db:sqlite:generate` | Generate SQLite migrations |
| `bun run db:sqlite:migrate` | Run SQLite migrations |
| `bun run db:postgresql:generate` · `:migrate` | PostgreSQL migrations |
| `bun run db:mysql:generate` · `:migrate` | MySQL migrations |

## 🗺️ Project Structure

```
src/
├── index.ts                # Entry point
├── api/
│   ├── index.ts            # API router setup
│   ├── utils/              # Response helpers, auth, OpenAPI, services
│   └── versions/v1/
│       ├── middleware/     # Auth middleware
│       ├── docs/           # OpenAPI tag definitions (Scalar UI mounted in api/index.ts)
│       └── routes/         # auth · account · mail-accounts · bimi · admin
│                           #   auth → reset-password
│                           #   account → apikeys · preferences
│                           #   mail-accounts → identities · search · mailboxes
│                           #     mailboxes → mail-bulk-actions · mails → attachments
├── db/
│   ├── index.ts            # DB connection
│   └── schema/             # Per-dialect Drizzle schema (sqlite · postgresql · mysql)
└── utils/
    ├── config.ts           # App configuration
    ├── cron.ts             # Scheduled tasks
    ├── crypto/             # ECC encryption & signing
    └── mails/              # Mail backends & parsing
```

> **Note:** Drizzle schema files are dialect-specific. When adding tables or columns, mirror the change across all three files in `src/db/schema/`.

## 📦 The Delivr Project

| Repository | Description |
|------------|-------------|
| **Delivr API** _(you are here)_ | The Bun + Hono backend |
| [**Delivr Web**](https://github.com/Delivr-Project/Delivr-Web) | The Nuxt 4 web client & PWA |

## 📄 License

Licensed under the [GNU AGPL-3.0](./LICENSE).

<div align="center"><sub>Built with 💙 and Bun.</sub></div>
