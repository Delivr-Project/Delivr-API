import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll } from "bun:test";
import { ConfigHandler } from "../../src/utils/config";
import { DB } from "../../src/db";
import { API } from "../../src/api";
import { MockIMAPServer } from "./mock-mail-servers/imap/server";

// Allow overriding the env file used for tests without clobbering existing env vars.
const TEST_ENV_FILE = process.env.TEST_ENV_FILE ?? ".env.local";

async function loadTestEnv(filePath: string) {
    try {
        const content = await Bun.file(filePath).text();
        for (const rawLine of content.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            const [key, ...rest] = line.split("=");
            if (!key) continue;
            const value = rest.join("=").trim();
            if (process.env[key] === undefined) {
                process.env[key] = value;
            }
        }
    } catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
    }
}

async function createIsolatedDataDir(): Promise<string> {
    const root = await fs.mkdtemp(path.join(process.cwd(), "tmp-data-"));
    return root;
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
                        "World 4!"
                },
                {
                    raw: "Subject: hello 5\r\n\r\nWorld 5!"
                },
                {
                    raw: "Subject: hello 6\r\n\r\nWorld 6!"
                }
            ],
            separator: ".",
            folders: {
                "Privat": {},
                "Work": {}
            }
        },
        "": {
            separator: ".",
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
    await loadTestEnv(TEST_ENV_FILE);

    // const config = await ConfigHandler.loadConfig();

    TMP_ROOT = await createIsolatedDataDir();

    await DB.init(
        path.join(TMP_ROOT, "db.sqlite"),
        true,
        TMP_ROOT
    );

    mockIMAPServer.listen(11143);

    await API.init();

    await API.start(14123, "::");

});

afterAll(async () => {

    await API.stop();

    mockIMAPServer.close();

    if (TMP_ROOT) {

        await fs.rm(TMP_ROOT, { recursive: true, force: true });
    }
});
