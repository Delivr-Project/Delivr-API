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
│           │   └── index.ts  # OpenAPI tag definitions (DOCS_TAGS)
│           └── routes/       # Route modules (auth, account, mail-accounts, bimi, admin)
│                              #   auth → reset-password
│                              #   account → apikeys, preferences
│                              #   mail-accounts → identities, search, mailboxes (nested)
│                              #     mailboxes → mail-bulk-actions, mails → attachments
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
- **OpenAPI specs**: Use `hono-openapi` decorators on route handlers via `APIRouteSpec`/`APIResponseSpec` helpers in `specHelpers.ts` (`summary`, `description`, `tags`). Tags come from `DOCS_TAGS` in `versions/v1/docs/index.ts`. When adding a new tag, also register it in the `tags` array **and** an `x-tagGroups` group in `versions/v1/index.ts`, or it renders orphaned in Scalar. The spec is served at `/docs/v1/openapi` and the Scalar UI at `/docs/v1` (both mounted in `api/index.ts`, gated by `DLA_DISABLE_DOCS`).
- **Database**: Schema files are per-dialect in `src/db/schema/`. Migrations managed via Drizzle Kit, schema ones with `bun db:sqlite:generate` and data ones with `drizzle-kit generate --custom --name=…`; both are plain SQL under `drizzle/migrations/sqlite/` and run from `DB.init()` unless `DLA_DB_AUTO_MIGRATE=false`. A data migration is written to be idempotent (guard with `WHERE NOT EXISTS`) and can only use what SQL can see — the mail account connection data is encrypted, so an address or credential is not reachable from a migration.
- **Auth**: JWT-based auth via `authHandler.ts`. Middleware in `src/api/versions/v1/middleware/auth.ts`.
- **Validation**: Zod schemas in `model.ts` files, validated via `@hono/standard-validator`.
- **Tests**: Integration-heavy. `bunfig.toml` preloads `tests/helpers/preload.ts`, which builds the app with `API.init()` but never binds a port — requests go through `API.getApp().request()` in-process, so the suite runs while a dev server is up. Mock IMAP servers do listen: `11143` for the shared one, `11144`–`11148` for per-test servers.
- **Config**: Environment-based config in `src/utils/config.ts`. See `example.env` for required vars.
- **Crypto**: ECC-based encryption/signing utilities in `src/utils/crypto/`.
- **Docker**: `docker/Dockerfile` packages a binary compiled beforehand (`bun run compile linux-x64-baseline --no-version-tag`, as CI does) together with `drizzle/migrations`, which the binary reads from disk. A relative `DLA_DB_MIGRATION_DIR` therefore has to be resolved next to the executable (`process.execPath`), not against `import.meta.dir`, which is Bun's virtual `/$bunfs/root` in a compiled binary. `docker/docker-compose.yml` runs the API alone and `docker/docker-compose.prodlike.yml` the full stack (API + Delivr-Web) from the ghcr.io images. The web image is configured at runtime through `NUXT_PUBLIC_*` variables (`DELIVR_*` is only read at build time), and it requires *public* URLs, since the web client's SSR server calls the API through the same `NUXT_PUBLIC_API_URL` as the browser.
- **Client addresses**: login rate limiting keys on the socket address (`getConnInfo` from `hono/bun`), or on the last `X-Forwarded-For` entry when `DLA_TRUST_PROXY=true`. In-process test requests have no socket and fall back to `unknown`, so one test serves the app on an ephemeral port to cover the socket path.
- **Deleting users and mail accounts** goes through `AccountDeletionService`. SQLite doesn't enforce the schema's foreign keys, so every table that references a user or mail account must be cleaned up there, or its rows are orphaned.
- **Transactions are only atomic with a synchronous callback.** The bun-sqlite driver commits as soon as the `transaction()` callback returns, so an `async` callback commits at its first `await` and nothing after it rolls back. Many existing routes still pass `async` callbacks; new code that relies on rollback (like `AccountDeletionService`) must use `.run()`/`.all()`/`.get()` without `await`.

## Architecture Notes

- The app uses a versioned API router (`apiVersionRouter.ts`) that mounts version sub-routers.
- Mail handling is split into backends (IMAP/SMTP) and resources (mail, mailbox).
- **Mail parsing is metadata-only**: `MailParser.parseMail` (via `postal-mime`) intentionally strips attachment *content*, keeping only metadata (`id`, `filename`, `contentType`, `size`, `contentId`, `contentDisposition`). The `id` is the attachment's index within the mail and is the handle used to fetch its bytes.
- **Attachment content is never stored or cached server-side**: the `/:mailUID/*` middleware fetches the parsed mail and its raw source in one IMAP snapshot (`getMailSnapshot`); the `attachments/:attachmentId` route parses that source transiently in-memory (`MailParser.getAttachmentContent`) and streams the single attachment out with `Cache-Control: no-store` (+ `nosniff`). `MailClientsCache` pools IMAP *connections* only, never message/attachment data.
- **Composing and sending**: `POST .../mails` and `PUT .../mails/:mailUID` both take either a JSON body or `multipart/form-data` with the mail as a JSON `mail` field plus repeated `attachments` files (attachments limited by `DLA_MAX_ATTACHMENT_SIZE_MB`, the whole request by that + 16 MB — checked against `Content-Length` up front and against the actual parts afterwards). Both return the resulting attachment metadata so a client can keep its ids in sync. Drafts keep their Bcc header in IMAP (`keepBcc`); `X-Priority`/`Importance`/`X-MSMail-Priority` headers are written for non-normal priorities and read back by `MailParser.parsePriority`.
- **Draft updates replace the message**: a `PUT` that changes content, attachments or `removeAttachments` rebuilds the draft, appends the new version and removes the old UID, so the UID changes — flag-only updates stay in place. Removal goes through `IMAPAccount.deleteReplacedMails`: with UIDPLUS the single UID is expunged, otherwise the old version is moved to Trash (a plain `EXPUNGE` would take every other `\Deleted` message in the mailbox with it), and without a Trash folder it is only flagged. The replacement never inherits `\Deleted`. A body sent on a `PUT` replaces *both* alternatives, so a new `html` never keeps the previous `text`. `removeAttachments` takes existing attachment ids; unknown ids are a 400. `IMAPAccount.createMail` returns the new UID (UIDPLUS `APPENDUID`, else a lookup).
- **Sending**: `POST .../send` relays the stored raw source via `SMTPAccount.sendRaw`, which puts Bcc recipients in the envelope and strips the header. With `moveToSent`, the mail is then filed into the Sent folder resolved by `SpecialUseService.resolveSentPath` (stored setting → detected `\Sent` → `null`); filing is best-effort and its outcome is reported as `savedToSent`, so a send never fails because the Sent folder is missing.
- Drizzle schema files are dialect-specific — changes should be mirrored across all three when adding new tables/columns.
- **User preferences are schemaless rows**, not columns: the `user_preferences` table stores one row per `(user_id, key)` with the value in a JSON `data` column. Both the remote-content-policy and auto-mark-as-seen preferences live here (keyed strings), accessed via `UserPreferencesHandler` (`utils/preferences.ts`). Adding a preference does **not** require a migration. `GET /account/preferences` returns every preference in one response via `UserPreferencesHandler.getAll`, derived from `UserPreferences.schemas`, so a new key shows up there automatically (it still needs its own GET/PUT sub-routes).
- **Every mail account has at least one sender identity**: `POST /mail-accounts` creates the account and its default identity in one transaction, taking the address from the optional `identity` body field or, failing that, from the SMTP username when that is an email address — neither means a 400, because an account with no address can't send. `DELETE .../identities/:id` refuses the account's last identity with a 409, and deleting the default hands that flag to the oldest remaining identity. Accounts predating the rule are backfilled by the `0014_backfill_default_mail_identities` migration. It cannot read the account's own address — that lives in the encrypted connection blob — so it builds the identity from the owner's `users.email` and leaves it **non-default**, which keeps a possibly-wrong address out of the composer's preselected sender (the account's decrypted SMTP address is listed first). Users correct it under the account's Identities settings. Each identity also carries an optional `signature` (nullable HTML, max 16 KB) that the web composer appends to mails sent from it; omitting the field on a `PUT` leaves it untouched, `null` clears it.
- **BIMI is resolved live, never persisted**: the `bimi/:domain` route uses `BimiService` to read the sender domain's BIMI DNS record and return the brand `logoUrl`. Only DNS metadata is read — the logo SVG is never fetched or stored server-side; the client loads it directly.
- **Bulk mail actions** (`mailboxes/.../mail-bulk-actions`) apply move/copy/delete/flag operations to many UIDs in a single IMAP round-trip, separate from the per-mail routes under `mails/`.
- **Outbound system mail** (e.g. password-reset emails) uses the `DLA_SMTP_*` config vars — distinct from the per-account IMAP/SMTP credentials stored encrypted in `mail_accounts`.
- The `data/` directory contains runtime data (SQLite DB files, etc.).
