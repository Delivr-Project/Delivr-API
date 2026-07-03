# Delivr API

## Tech Stack

- **Runtime**: Bun 1.x
- **Framework**: Hono 4.x
- **Language**: TypeScript 6.x
- **ORM**: Drizzle ORM 0.45.x with Drizzle Kit 0.31.x
- **Validation**: Zod 4.x + `@hono/standard-validator`
- **OpenAPI**: `hono-openapi` + `@scalar/hono-api-reference`
- **Database**: SQLite (default, via `@libsql/client`), PostgreSQL, MySQL
- **Mail**: IMAP (`imapflow`) + SMTP (`nodemailer`) + `postal-mime` parsing
- **Crypto**: `elliptic` (ECC), custom encryption utilities
- **Scheduling**: `cron` package

## Project Structure

```
src/
├── index.ts                  # Entry point
├── api/
│   ├── index.ts              # API router setup
│   ├── utils/                # Shared API utilities
│   │   ├── api-res.ts        # Response helpers
│   │   ├── apiVersionRouter.ts
│   │   ├── authHandler.ts    # Auth middleware
│   │   ├── metadata.ts
│   │   ├── preferences.ts
│   │   ├── specHelpers.ts    # OpenAPI spec helpers
│   │   ├── shared-models/    # Shared Zod models
│   │   └── services/         # Business logic services
│   └── versions/
│       └── v1/
│           ├── index.ts      # v1 router
│           ├── middleware/
│           │   └── auth.ts
│           ├── docs/
│           │   └── index.ts  # Scalar API reference
│           └── routes/       # Route modules (auth, account, mail-accounts, admin)
│                              #   mail-accounts → mailboxes → mails → attachments (nested)
├── db/
│   ├── index.ts              # DB connection setup
│   ├── utils.ts              # DB utilities
│   └── schema/               # Drizzle schema per dialect
│       ├── sqlite.ts
│       ├── postgresql.ts
│       └── mysql.ts
└── utils/
    ├── index.ts
    ├── config.ts             # App configuration
    ├── cron.ts               # Scheduled tasks
    ├── logger.ts
    ├── crypto/               # Encryption & signing
    └── mails/                # Mail backends & parsing
```

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server with watch mode |
| `bun run typecheck` | Run TypeScript type checking |
| `bun test` | Run test suite |
| `bun run db:sqlite:generate` | Generate SQLite migrations |
| `bun run db:sqlite:migrate` | Run SQLite migrations |
| `bun run db:postgresql:generate` | Generate PostgreSQL migrations |
| `bun run db:postgresql:migrate` | Run PostgreSQL migrations |
| `bun run db:mysql:generate` | Generate MySQL migrations |
| `bun run db:mysql:migrate` | Run MySQL migrations |
| `bun run compile` | Compile the project |
| `bun run start` | Production entry point |

## Key Conventions

- **API versioning**: Routes live under `src/api/versions/v{n}/routes/`. Each route module has an `index.ts` (router) and `model.ts` (Zod schemas).
- **OpenAPI specs**: Use `hono-openapi` decorators on route handlers. Spec helpers in `specHelpers.ts`.
- **Database**: Schema files are per-dialect in `src/db/schema/`. Migrations managed via Drizzle Kit.
- **Auth**: JWT-based auth via `authHandler.ts`. Middleware in `src/api/versions/v1/middleware/auth.ts`.
- **Validation**: Zod schemas in `model.ts` files, validated via `@hono/standard-validator`.
- **Tests**: Integration-heavy. `bunfig.toml` preloads `tests/helpers/preload.ts`. Uses fixed ports `12150`/`12151`.
- **Config**: Environment-based config in `src/utils/config.ts`. See `example.env` for required vars.
- **Crypto**: ECC-based encryption/signing utilities in `src/utils/crypto/`.

## Architecture Notes

- The app uses a versioned API router (`apiVersionRouter.ts`) that mounts version sub-routers.
- Mail handling is split into backends (IMAP/SMTP) and resources (mail, mailbox).
- **Mail parsing is metadata-only**: `MailParser.parseMail` (via `postal-mime`) intentionally strips attachment *content*, keeping only metadata (`id`, `filename`, `contentType`, `size`, `contentId`, `contentDisposition`). The `id` is the attachment's index within the mail and is the handle used to fetch its bytes.
- **Attachment content is never stored or cached server-side**: the `attachments/:attachmentId` route re-fetches the message source from IMAP, parses it transiently in-memory (`MailParser.getAttachmentContent`), and streams the single attachment out with `Cache-Control: no-store` (+ `nosniff`). `MailClientsCache` pools IMAP *connections* only, never message/attachment data.
- Drizzle schema files are dialect-specific — changes should be mirrored across all three when adding new tables/columns.
- The `data/` directory contains runtime data (SQLite DB files, etc.).
