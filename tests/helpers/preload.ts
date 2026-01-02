import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll } from "bun:test";
import { ConfigHandler } from "../../src/utils/config";
import { DB } from "../../src/db";
import { API } from "../../src/api";

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

beforeAll(async () => {
    await loadTestEnv(TEST_ENV_FILE);

    // const config = await ConfigHandler.loadConfig();

    TMP_ROOT = await createIsolatedDataDir();

    await DB.init(
        path.join(TMP_ROOT, "db.sqlite"),
        true,
        TMP_ROOT
    );


    await API.init();

    await API.start(14123, "::");

});

afterAll(async () => {
    if (TMP_ROOT) {

        await fs.rm(TMP_ROOT, { recursive: true, force: true });
    }
});
