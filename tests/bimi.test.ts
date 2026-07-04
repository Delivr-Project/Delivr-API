import { describe, expect, test, beforeAll } from "bun:test";
import { BimiService } from "../src/api/utils/services/bimiService";
import { BimiModel } from "../src/api/versions/v1/routes/bimi/model";
import { SessionHandler } from "../src/api/utils/authHandler";
import { DB } from "../src/db";
import { randomUUID } from "crypto";
import { makeAPIRequest } from "./helpers/api";

describe("BIMI record parsing", () => {

    const DOMAIN = "example.com";
    const SELECTOR = "default";

    test("parses a full BIMI1 record with logo and authority", () => {
        const record = BimiService.parseRecord(
            "v=BIMI1; l=https://example.com/logo.svg; a=https://example.com/vmc.pem",
            DOMAIN, SELECTOR
        );

        expect(record).not.toBeNull();
        expect(record!.version).toBe("BIMI1");
        expect(record!.logoUrl).toBe("https://example.com/logo.svg");
        expect(record!.authorityUrl).toBe("https://example.com/vmc.pem");
        expect(record!.domain).toBe(DOMAIN);
        expect(record!.selector).toBe(SELECTOR);
    });

    test("parses a record with a logo but no authority", () => {
        const record = BimiService.parseRecord(
            "v=BIMI1; l=https://example.com/logo.svg",
            DOMAIN, SELECTOR
        );

        expect(record).not.toBeNull();
        expect(record!.logoUrl).toBe("https://example.com/logo.svg");
        expect(record!.authorityUrl).toBeNull();
    });

    test("is tolerant of extra whitespace and empty tags", () => {
        const record = BimiService.parseRecord(
            "  v=BIMI1 ;  l=https://example.com/logo.svg ;; a= ;",
            DOMAIN, SELECTOR
        );

        expect(record).not.toBeNull();
        expect(record!.logoUrl).toBe("https://example.com/logo.svg");
        expect(record!.authorityUrl).toBeNull();
    });

    test("rejects a record without a logo URL", () => {
        expect(BimiService.parseRecord("v=BIMI1;", DOMAIN, SELECTOR)).toBeNull();
        expect(BimiService.parseRecord("v=BIMI1; l=", DOMAIN, SELECTOR)).toBeNull();
    });

    test("rejects a non-HTTPS logo URL", () => {
        expect(BimiService.parseRecord(
            "v=BIMI1; l=http://example.com/logo.svg", DOMAIN, SELECTOR
        )).toBeNull();
    });

    test("rejects a malformed logo URL", () => {
        expect(BimiService.parseRecord(
            "v=BIMI1; l=not-a-url", DOMAIN, SELECTOR
        )).toBeNull();
    });

    test("rejects records that are not BIMI1", () => {
        expect(BimiService.parseRecord(
            "v=spf1 include:example.com ~all", DOMAIN, SELECTOR
        )).toBeNull();
        expect(BimiService.parseRecord(
            "l=https://example.com/logo.svg", DOMAIN, SELECTOR
        )).toBeNull();
    });

    test("resolves against the API model shape", () => {
        const record = BimiService.parseRecord(
            "v=BIMI1; l=https://example.com/logo.svg; a=https://example.com/vmc.pem",
            DOMAIN, SELECTOR
        );
        const parse = BimiModel.Record.safeParse(record);
        expect(parse.success).toBe(true);
    });
});

describe("BIMI resolution (no network)", () => {

    test("returns null for obviously invalid domains without querying DNS", async () => {
        expect(await BimiService.resolve("")).toBeNull();
        expect(await BimiService.resolve("not a domain")).toBeNull();
        expect(await BimiService.resolve("localhost")).toBeNull();
    });
});

describe("BIMI route", () => {

    let sessionToken: string;

    beforeAll(async () => {
        const user = DB.instance().insert(DB.Tables.users).values({
            username: `bimi_${randomUUID().slice(0, 8)}`,
            display_name: "BIMI Test User",
            email: `${randomUUID()}@example.com`,
            password_hash: await Bun.password.hash("TestP@ssw0rd"),
            role: "user",
        } as any).returning().get();

        sessionToken = await SessionHandler.createSession(user.id).then(s => s.token);
    });

    test("requires authentication", async () => {
        await makeAPIRequest("/v1/bimi/example.com", {}, 401);
    });

    test("returns 404 when the domain publishes no BIMI record", async () => {
        // A domain that is syntactically valid but will not resolve a BIMI record.
        await makeAPIRequest(
            `/v1/bimi/${randomUUID().slice(0, 8)}.invalid-tld-that-does-not-exist`,
            { authToken: sessionToken },
            404
        );
    });
});
