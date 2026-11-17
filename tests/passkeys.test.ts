import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { DB } from "../src/db";
import { AccountPasskeysModel } from "../src/api/versions/v1/routes/account/passkeys/model";
import { PasskeyLoginModel } from "../src/api/versions/v1/routes/auth/passkey/model";
import { AccountDeletionService } from "../src/api/utils/services/accountDeletionService";
import type { DrizzleDB } from "../src/db/utils";
import { makeAPIRequest } from "./helpers/api";
import { seedSession, seedUser, type SeededUser } from "./helpers/seed";
import { SoftwareAuthenticator } from "./helpers/webauthn";
import { RequestLimiter } from "../src/api/utils/rateLimiters";
import { getClientRateLimitKey } from "../src/api/utils/clientIP";
import { API } from "../src/api";

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

    test("getClientRateLimitKey groups IPv6 clients by /64", () => {
        expect(getClientRateLimitKey("203.0.113.1")).toBe("203.0.113.1");
        expect(getClientRateLimitKey("2001:db8:0:1::5")).toBe("2001:db8:0:1::/64");
        expect(getClientRateLimitKey("2001:db8:0:1:ffff::9")).toBe("2001:db8:0:1::/64");
    });

    test("POST /v1/auth/passkey/options is limited per client", async () => {
        const request = () => API.getApp().request("/v1/auth/passkey/options", { method: "POST" }, { clientIP: "198.51.100.200" });

        for (let i = 0; i < 30; i++) {
            expect((await request()).status).toBe(200);
        }

        const limited = await request();
        expect(limited.status).toBe(429);
        expect(limited.headers.get("Retry-After")).toBe("300");

        const otherClient = await API.getApp().request("/v1/auth/passkey/options", { method: "POST" }, { clientIP: "198.51.100.201" });
        expect(otherClient.status).toBe(200);
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

    test("POST /v1/auth/passkey signs in without a password", async () => {
        const { authenticator } = await registerPasskey(user, sessionToken);

        const { challenge_id, options } = await makeAPIRequest("/v1/auth/passkey/options", {
            method: "POST",
            expectedBodySchema: PasskeyLoginModel.Options.Response
        });

        const session = await makeAPIRequest("/v1/auth/passkey", {
            method: "POST",
            body: { challenge_id, response: authenticator.createAuthenticationResponse(options.challenge) },
            expectedBodySchema: PasskeyLoginModel.Login.Response
        });

        expect(session.user_id).toBe(user.id);
        await makeAPIRequest("/v1/account", { authToken: session.token });

        const stored = DB.instance().select().from(DB.Tables.userPasskeys).where(eq(DB.Tables.userPasskeys.id, authenticator.id)).get();
        expect(stored?.counter).toBe(1);
        expect(stored?.last_used_at).not.toBeNull();

        await makeAPIRequest("/v1/auth/passkey", {
            method: "POST",
            body: { challenge_id, response: authenticator.createAuthenticationResponse(options.challenge) }
        }, 400);
    });

    test("POST /v1/auth/passkey needs user verification", async () => {
        const { authenticator } = await registerPasskey(user, sessionToken, new SoftwareAuthenticator(false));

        const { challenge_id, options } = await makeAPIRequest("/v1/auth/passkey/options", {
            method: "POST",
            expectedBodySchema: PasskeyLoginModel.Options.Response
        });

        await makeAPIRequest("/v1/auth/passkey", {
            method: "POST",
            body: { challenge_id, response: authenticator.createAuthenticationResponse(options.challenge) }
        }, 401);
    });

    test("POST /v1/auth/passkey rejects an unknown passkey", async () => {
        const { challenge_id, options } = await makeAPIRequest("/v1/auth/passkey/options", {
            method: "POST",
            expectedBodySchema: PasskeyLoginModel.Options.Response
        });

        await makeAPIRequest("/v1/auth/passkey", {
            method: "POST",
            body: { challenge_id, response: new SoftwareAuthenticator().createAuthenticationResponse(options.challenge) }
        }, 401);
    });

    test("PUT and DELETE /v1/account/passkeys/:passkeyID", async () => {
        const { authenticator } = await registerPasskey(user, sessionToken);
        const other = await seedUser("user");
        const otherToken = await seedSession(other.id);

        const renamed = await makeAPIRequest(`/v1/account/passkeys/${authenticator.id}`, {
            method: "PUT",
            authToken: sessionToken,
            body: { name: "Phone" },
            expectedBodySchema: AccountPasskeysModel.Update.Response
        });
        expect(renamed.name).toBe("Phone");

        await makeAPIRequest(`/v1/account/passkeys/${authenticator.id}`, {
            method: "PUT",
            authToken: otherToken,
            body: { name: "Stolen" }
        }, 404);

        await makeAPIRequest(`/v1/account/passkeys/${authenticator.id}`, {
            method: "DELETE",
            authToken: otherToken
        }, 404);

        await makeAPIRequest(`/v1/account/passkeys/${authenticator.id}`, {
            method: "DELETE",
            authToken: sessionToken
        });

        await makeAPIRequest(`/v1/account/passkeys/${authenticator.id}`, {
            method: "DELETE",
            authToken: sessionToken
        }, 404);

        const { challenge_id, options } = await makeAPIRequest("/v1/auth/passkey/options", {
            method: "POST",
            expectedBodySchema: PasskeyLoginModel.Options.Response
        });

        await makeAPIRequest("/v1/auth/passkey", {
            method: "POST",
            body: { challenge_id, response: authenticator.createAuthenticationResponse(options.challenge) }
        }, 401);
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
