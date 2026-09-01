import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll } from "bun:test";
import { ConfigHandler, type ParsedConfig } from "../../src/utils/config";
import { DB } from "../../src/db";
import { API } from "../../src/api";
import { MockIMAPServer } from "./mock-mail-servers/imap/server";
import { Utils } from "../../src/utils";
import { LCrypt } from "../../src/utils/crypto/lcrypt";
import { MailAccountEncryption } from "../../src/utils/crypto/mailCrypt";

// Allow overriding the env file used for tests without clobbering existing env vars.
const TEST_ENV_FILE = process.env.TEST_ENV_FILE ?? ".env.local";

function setTestEnv(rootDir: string) {

    const envVars = {
        DLA_LOG_LEVEL: "debug",

        DLA_APP_URL: "http://localhost:12153",
        
        DLA_API_HOST: "::",
        DLA_API_PORT: "1",
        DLA_DISABLE_DOCS: true,

        DLA_ENCRYPTION_KEY: "67e3d03dc88682553deed5fa4484bd80a500783850efbb49f6912ad0935eedeb",

        DLA_LOG_DIR: path.join(rootDir, "logs"),
        DLA_CONFIG_BASE_DIR: rootDir,

        DLA_DB_CONNECTION_URL: path.join(rootDir, "db.sqlite"),
        DLA_DB_AUTO_MIGRATE: true,
        DLA_MAX_ATTACHMENT_SIZE_MB: "25",

        DLA_SMTP_HOST: "127.0.0.1",
        DLA_SMTP_PORT: "12587",
        DLA_SMTP_USERNAME: "",
        DLA_SMTP_PASSWORD: "",
        DLA_SMTP_FROM: "\"Delivr Test\" <test@delivr.local>",
        DLA_SMTP_SECURE: false,

    } as const satisfies ParsedConfig;

    for (const [key, value] of Object.entries(envVars)) {
        process.env[key] = String(value);
    }
}

async function createIsolatedDataDir(): Promise<string> {
    const root = await fs.mkdtemp(path.join(process.cwd(), "tmp-data-"));
    return root;
}

/**
 * On Windows, file handles (e.g. the SQLite DB file) can take a moment to be
 * released after closing, making an immediate recursive removal flaky (EBUSY).
 * Retries manually since Bun's `fs.rm` doesn't reliably honor `maxRetries`/`retryDelay`.
 */
async function removeDirWithRetry(dir: string, attempts = 10, delayMs = 300) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await fs.rm(dir, { recursive: true, force: true });
            return;
        } catch (err: any) {
            if (attempt === attempts || (err?.code !== "EBUSY" && err?.code !== "ENOTEMPTY" && err?.code !== "EPERM")) {
                throw err;
            }
            await Bun.sleep(delayMs);
        }
    }
}

let TMP_ROOT: string | null = null;


const mockIMAPServer = new MockIMAPServer({
    plugins: ["ID", "STARTTLS" /*, "LOGINDISABLED"*/, "SASL-IR", "AUTH-PLAIN", "NAMESPACE", "IDLE", "ENABLE", "CONDSTORE", "XTOYBIRD", "LITERALPLUS", "UNSELECT", "SPECIAL-USE", "CREATE-SPECIAL-USE"],
    id: {
        name: "Mock_IMAP Server",
        version: "1.0.0",
    },
    storage: {
        "INBOX": {
            messages: [
                {
                    raw: "Subject: hello 1\r\n\r\nWorld 1!",
                    internaldate: "14-Sep-2013 21:22:28 -0300"
                },
                {
                    raw: "Subject: hello 2\r\n\r\nWorld 2!",
                    flags: ["\\Seen"]
                },
                {
                    raw: "Subject: hello 3\r\n\r\nWorld 3!"
                },
                {
                    raw: "From: sender name <sender@example.com>\r\n" +
                        "To: Receiver name <receiver@example.com>\r\n" +
                        "Subject: hello 4\r\n" +
                        "Message-Id: <abcde>\r\n" +
                        "Date: Fri, 13 Sep 2013 15:01:00 +0300\r\n" +
                        "\r\n" +
                        "World 4!",
                    flags: ["\\Seen", "\\Answered", "\\Flagged"]
                },
                {
                    raw: "Subject: hello 5\r\n\r\nWorld 5!"
                },
                {
                    raw: "Subject: hello 6\r\n\r\nWorld 6!"
                }
            ],
            separator: "/",
            folders: {
                "Privat": {},
                "Work": {}
            }
        },
        "": {
            separator: "/",
            folders: {
                // "All Mail": {
                //     "special-use": "\\All"
                // },
                "Drafts": {
                    "special-use": "\\Drafts"
                },
                // "Important": {
                //     "special-use": "\\Important"
                // },
                "Sent": {
                    "special-use": "\\Sent"
                },
                "Spam": {
                    "special-use": "\\Junk"
                },
                // "Starred": {
                //     "special-use": "\\Flagged"
                // },
                "Trash": {
                    "special-use": "\\Trash"
                }
            },
        }
    },
    debug: false
});


beforeAll(async () => {    
    TMP_ROOT = await createIsolatedDataDir();

    setTestEnv(TMP_ROOT);

    const config = await ConfigHandler.loadConfig();

    const encryptionKey = LCrypt.randomBytes(32).toString("hex");
    MailAccountEncryption.init(encryptionKey);

    await DB.init(
        path.join(TMP_ROOT, "db.sqlite"),
        true,
        TMP_ROOT
    );

    // EmailService is NOT initialised here — tests that need it call
    // EmailService.init(mockTransport) in their own beforeAll.

    mockIMAPServer.listen(11143);

    await API.init();

    await API.start(14123, "::");

});

afterAll(async () => {

    await API.stop();

    mockIMAPServer.close();

    await DB.close();

    if (TMP_ROOT) {
        await removeDirWithRetry(TMP_ROOT);
    }
});
