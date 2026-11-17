import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { DB } from "../src/db";
import { AccountPasskeysModel } from "../src/api/versions/v1/routes/account/passkeys/model";
import { AccountDeletionService } from "../src/api/utils/services/accountDeletionService";
import type { DrizzleDB } from "../src/db/utils";
import { makeAPIRequest } from "./helpers/api";
import { seedSession, seedUser, type SeededUser } from "./helpers/seed";
import { SoftwareAuthenticator } from "./helpers/webauthn";
import { RequestLimiter } from "../src/api/utils/rateLimiters";

async function registerPasskey(user: SeededUser, sessionToken: string, authenticator = new SoftwareAuthenticator()) {
    const { options } = await makeAPIRequest("/v1/account/passkeys/options", {
        method: "POST",
        authToken: sessionToken,
        body: { current_password: user.password },
        expectedBodySchema: AccountPasskeysModel.RegistrationOptions.Response
    });

    const passkey = await makeAPIRequest("/v1/account/passkeys", {
        method: "POST",
        authToken: sessionToken,
        body: { name: "Laptop", response: authenticator.createRegistrationResponse(options.challenge) },
        expectedBodySchema: AccountPasskeysModel.Create.Response
    }, 201);

    return { authenticator, passkey };
}

describe("Rate limiters", () => {

    test("RequestLimiter limits known clients and skips unknown ones", () => {
        const limiter = new RequestLimiter(60_000, 2);

        expect(limiter.hit("203.0.113.1")).toBe(true);
        expect(limiter.hit("203.0.113.1")).toBe(true);
        expect(limiter.hit("203.0.113.1")).toBe(false);
        expect(limiter.hit("203.0.113.2")).toBe(true);
        expect(limiter.hit(null)).toBe(true);
    });

});

describe("Passkeys", () => {

    let user: SeededUser;
    let sessionToken: string;

    beforeAll(async () => {
        user = await seedUser("user");
        sessionToken = await seedSession(user.id);
    });

    test("POST /v1/account/passkeys/options with wrong current password fails", async () => {
        await makeAPIRequest("/v1/account/passkeys/options", {
            method: "POST",
            authToken: sessionToken,
            body: { current_password: `${user.password}-wrong` }
        }, 400);
    });

    test("POST /v1/account/passkeys registers a passkey", async () => {
        const { authenticator, passkey } = await registerPasskey(user, sessionToken);

        expect(passkey.id).toBe(authenticator.id);
        expect(passkey.name).toBe("Laptop");
        expect(passkey.device_type).toBe("singleDevice");

        const passkeys = await makeAPIRequest("/v1/account/passkeys", {
            authToken: sessionToken,
            expectedBodySchema: AccountPasskeysModel.GetAll.Response
        });
        expect(passkeys.map(p => p.id)).toContain(authenticator.id);
    });

    test("POST /v1/account/passkeys without a pending challenge fails", async () => {
        const authenticator = new SoftwareAuthenticator();

        await makeAPIRequest("/v1/account/passkeys", {
            method: "POST",
            authToken: sessionToken,
            body: { name: "Replay", response: authenticator.createRegistrationResponse("bm8tY2hhbGxlbmdl") }
        }, 400);
    });

    test("POST /v1/account/passkeys rejects a response for another challenge", async () => {
        await makeAPIRequest("/v1/account/passkeys/options", {
            method: "POST",
            authToken: sessionToken,
            body: { current_password: user.password }
        });

        await makeAPIRequest("/v1/account/passkeys", {
            method: "POST",
            authToken: sessionToken,
            body: { name: "Wrong challenge", response: new SoftwareAuthenticator().createRegistrationResponse("d3JvbmctY2hhbGxlbmdl") }
        }, 400);
    });

});

describe("Account deletion", () => {

    test("removes the passkeys", async () => {
        const user = await seedUser("user");
        const sessionToken = await seedSession(user.id);
        await registerPasskey(user, sessionToken);

        DB.instance().transaction((tx: DrizzleDB) => {
            AccountDeletionService.deleteUser(user.id, tx);
        });

        expect(DB.instance().select().from(DB.Tables.userPasskeys).where(eq(DB.Tables.userPasskeys.user_id, user.id)).all()).toHaveLength(0);
    });
});
