import { describe, expect, test } from "bun:test";
import { API } from "../src/api";
import { DB } from "../src/db";
import { AuthHandler, AuthUtils, SessionHandler } from "../src/api/utils/authHandler";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { AuthModel } from "../src/api/routes/auth/model";
import { makeAPIRequest } from "./helpers/api";
import { AccountModel } from "../src/api/routes/account/model";


async function seedUser(role: "admin" | "user", overrides: Partial<DB.Models.User> = {}, password = "TestP@ssw0rd") {
    const user = DB.instance().insert(DB.Schema.users).values({
        username: overrides.username ?? `user_${randomUUID().slice(0, 8)}`,
        display_name: overrides.display_name ?? "Test User",
        email: overrides.email ?? `${randomUUID()}@example.com`,
        password_hash: await Bun.password.hash(password),
        role,
    } as any).returning().get();

    return { ...user, password } as Omit<typeof user & { password: string }, "password_hash">;
}

async function seedSession(user_id: number) {
    const session = await SessionHandler.createSession(user_id);
    return session;
    
}

let testAdmin = await seedUser("admin", { username: "testadmin" }, "AdminP@ss1");
let testUser = await seedUser("user", { username: "testuser" }, "UserP@ss1");

describe("Auth routes and access checks", async () => {

    let session_token: string;

    test("POST /auth/login authenticates and creates session", async () => {

        const data = await makeAPIRequest("/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: testUser.password },
            expectedBodySchema: AuthModel.Login.Response
        });

        expect(data.token.startsWith("dla_sess_")).toBe(true);
        
        session_token = data.token;

        const session = await AuthHandler.getAuthContext(data.token);

        expect(session).toBeDefined();
        if (!session) return;

        expect(session.user_id).toBe(testUser.id);
        expect(session.user_role).toBe("user");
        expect(session.type).toBe("session");
        expect(session.expires_at).toBeGreaterThan(Date.now());

        const tokenParts = AuthUtils.getTokenParts(data.token);
        expect(tokenParts).toBeDefined();
        if (!tokenParts) return;
        
        expect(await AuthUtils.verifyHashedTokenBase(tokenParts.base, session.hashed_token)).toBe(true);
        expect(tokenParts.prefix).toBe("dla_sess_");
        expect(tokenParts.id).toBe(session.id);
    });

    test("POST /auth/login with invalid credentials fails", async () => {

        await makeAPIRequest("/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: "WrongPassword" },
        }, 401);

    });

    test("GET /auth/session returns current session info", async () => {

        const data = await makeAPIRequest("/auth/session", {
            authToken: session_token,
            expectedBodySchema: AuthModel.Session.Response
        });

        expect(data.user_id).toBe(testUser.id);
        expect(data.user_role).toBe("user");
    });

    test("GET /auth/session with invalid token fails", async () => {

        await makeAPIRequest("/auth/session", {
            authToken: "invalid_token",
        }, 401);

    });

    test("POST /auth/logout invalidates session", async () => {

        await makeAPIRequest("/auth/logout", {
            method: "POST",
            authToken: session_token
        });

        const session = await AuthHandler.getAuthContext(session_token);

        expect(session).toBeNil();
    });
});

describe("Account routes", async () => {

    let session_token = await seedSession(testUser.id).then(s => s.token);

    test("GET /account returns current user", async () => {

        const data = await makeAPIRequest("/account", {
            authToken: session_token,
            expectedBodySchema: AccountModel.GetInfo.Response
        });

        expect(data.id).toBe(testUser.id);
        expect(data.username).toBe(testUser.username);
        expect(data.display_name).toBe(testUser.display_name);
        expect(data.email).toBe(testUser.email);
        expect(data.role).toBe("user");
    });

    test("PUT /account updates profile fields", async () => {
        
        const newUserData = {
            display_name: "Updated Name",
            username: "updatedusername",
            email: "updated@example.com"
        }

        await makeAPIRequest("/account", {
            method: "PUT",
            authToken: session_token,
            body: newUserData
        });

        testUser.display_name = newUserData.display_name;
        testUser.username = newUserData.username;
        testUser.email = newUserData.email;

        const dbresult = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, testUser.id)).get();

        expect(dbresult?.display_name).toBe(newUserData.display_name);
        expect(dbresult?.username).toBe(newUserData.username);
        expect(dbresult?.email).toBe(newUserData.email);
    });

    test("PUT /account try updating role fails", async () => {
        
        await makeAPIRequest("/account", {
            method: "PUT",
            authToken: session_token,
            body: { role: "admin" }
        }, 400);
        
        const dbresult = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, testUser.id)).get();
        expect(dbresult?.role).toBe("user");
    });

    test("PUT /account/password rotates credentials and invalidates old sessions", async () => {

        const oldPassword = testUser.password;
        const newPassword = "NewP@ssw0rd1";

        await makeAPIRequest("/account/password", {
            method: "PUT",
            authToken: session_token,
            body: {
                current_password: oldPassword,
                new_password: newPassword
            }
        });

        testUser.password = newPassword;

        // Old session should be invalidated
        await makeAPIRequest("/account", {
            authToken: session_token,
        }, 401);

        // Login with old password should fail
        await makeAPIRequest("/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: oldPassword }
        }, 401);

        // Login with new password should succeed
        const data = await makeAPIRequest("/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: newPassword },
            expectedBodySchema: AuthModel.Login.Response
        });

        expect(data.token.startsWith("dla_sess_")).toBe(true);

        session_token = data.token;
    });

    test("DELETE /account removes user data", async () => {
        
        await makeAPIRequest("/account", {
            method: "DELETE",
            authToken: session_token
        });

        const dbresult = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, testUser.id)).get();
        expect(dbresult).toBeUndefined();

        // recreate test user for further tests
        testUser = await seedUser("user", { username: "testuser" }, "UserP@ss1");
    });
});

