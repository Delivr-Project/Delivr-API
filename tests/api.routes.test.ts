import { afterAll, describe, expect, test, beforeAll, spyOn } from "bun:test";
import { API } from "../src/api";
import { DB } from "../src/db";
import { AuthHandler, AuthUtils, SessionHandler } from "../src/api/utils/authHandler";
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { AuthModel } from "../src/api/versions/v1/routes/auth/model";
import { makeAPIRequest } from "./helpers/api";
import { AccountModel } from "../src/api/versions/v1/routes/account/model";
import { AccountPreferencesModel } from "../src/api/versions/v1/routes/account/preferences/model";
import { MailAccountsModel } from "../src/api/versions/v1/routes/mail-accounts/model";
import { MailIdentitiesModel } from "../src/api/versions/v1/routes/mail-accounts/identities/model";
import { MailboxesModel } from "../src/api/versions/v1/routes/mail-accounts/mailboxes/model";
import { SpecialUseModel } from "../src/api/versions/v1/routes/mail-accounts/special-use/model";
import { SpecialUse, SpecialUseHandler } from "../src/api/utils/services/specialUseService";
import { MailboxRessource } from "../src/utils/mails/ressources/mailbox";
import { IMAPAccount } from "../src/utils/mails/backends/imap";
import { MailAccountEncryption } from "../src/utils/crypto/mailCrypt";
import { MailsModel } from "../src/api/versions/v1/routes/mail-accounts/mailboxes/mails/model";
import { SearchModel } from "../src/api/versions/v1/routes/mail-accounts/search/model";
import { MailBulkActionsModel } from "../src/api/versions/v1/routes/mail-accounts/mailboxes/mail-bulk-actions/model";
import { AttachmentsModel } from "../src/api/versions/v1/routes/mail-accounts/mailboxes/mails/attachments/model";
import { hashResetToken } from "../src/api/versions/v1/routes/auth/reset-password";
import { SMTPAccount } from "../src/utils/mails/backends/smtp";
import { MailParser } from "../src/utils/mails/parser";
import { ConfigHandler } from "../src/utils/config";

type SeededUser = Omit<DB.Models.User, "password_hash"> & { password: string };
type SeededSession = Awaited<ReturnType<typeof SessionHandler.createSession>>;

async function seedUser(role: DB.Models.User["role"], overrides: Partial<DB.Models.User> = {}, password = "TestP@ssw0rd") {
    const user = DB.instance().insert(DB.Tables.users).values({
        username: overrides.username ?? `user_${randomUUID().slice(0, 8)}`,
        display_name: overrides.display_name ?? "Test User",
        email: overrides.email ?? `${randomUUID()}@example.com`,
        password_hash: await Bun.password.hash(password),
        role,
    } as any).returning().get();

    return { ...user, password } satisfies SeededUser;
}

async function seedSession(user_id: number) {
    const session = await SessionHandler.createSession(user_id);
    return session satisfies SeededSession;
}

async function seedMailAccount(ownerUserId: number) {

    const encryptedSMTPData = MailAccountEncryption.encryptSMTPData({
        host: "smtp.example.com",
        port: 587,
        username: "smtpuser",
        password: "smtppass",
        useSSL: "STARTTLS"
    });

    const encryptedIMAPData = MailAccountEncryption.encryptIMAPData({
        host: "imap.example.com",
        port: 993,
        username: "imapuser",
        password: "imappass",
        useSSL: "SSL"
    });

    if (!encryptedSMTPData || !encryptedIMAPData) {
        throw new Error("Failed to encrypt mail account data");
    }

    // Seed a mail account
    const mailAccount = await DB.instance().insert(DB.Tables.mailAccounts).values({
        owner_user_id: ownerUserId,
        display_name: "Test Mail Account",
        smtp_encrypted_connection_data: encryptedSMTPData,
        imap_encrypted_connection_data: encryptedIMAPData
    }).returning().get();

    return mailAccount;
}

let testUser: SeededUser;
let testAdmin: SeededUser;

beforeAll(async () => {
    testUser = await seedUser("user", { username: "testuser" }, "UserP@ss1");
    testAdmin = await seedUser("admin", { username: "testadmin" }, "AdminP@ss1");
});

describe("Auth routes and access checks", async () => {

    let session_token: string;

    test("POST /v1/auth/login authenticates and creates session", async () => {

        const data = await makeAPIRequest("/v1/auth/login", {
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

    test("POST /v1/auth/login with invalid credentials fails", async () => {

        await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: "WrongPassword" },
        }, 401);

    });

    test("GET /v1/auth/session returns current session info", async () => {

        const data = await makeAPIRequest("/v1/auth/session", {
            authToken: session_token,
            expectedBodySchema: AuthModel.Session.Response
        });

        expect(data.user_id).toBe(testUser.id);
        expect(data.user_role).toBe("user");
    });

    test("GET /v1/auth/session with invalid token fails", async () => {

        await makeAPIRequest("/v1/auth/session", {
            authToken: "invalid_token",
        }, 401);

    });

    test("POST /v1/auth/logout invalidates session", async () => {

        await makeAPIRequest("/v1/auth/logout", {
            method: "POST",
            authToken: session_token
        });

        const session = await AuthHandler.getAuthContext(session_token);

        expect(session).toBeNil();
    });
});

describe("Auth reset-password routes", async () => {

    let resetUser: SeededUser;
    let resetSessionToken: string;

    beforeAll(async () => {
        resetUser = await seedUser("user");
        resetSessionToken = await seedSession(resetUser.id).then(s => s.token);
    });

    test("POST /v1/auth/reset-password/request returns success for existing and unknown emails", async () => {
        await makeAPIRequest("/v1/auth/reset-password/request", {
            method: "POST",
            body: { email: resetUser.email }
        }, 200);

        await makeAPIRequest("/v1/auth/reset-password/request", {
            method: "POST",
            body: { email: `nope-${randomUUID()}@example.com` }
        }, 200);
    });

    test("POST /v1/auth/reset-password/request denies authenticated users", async () => {
        await makeAPIRequest("/v1/auth/reset-password/request", {
            method: "POST",
            authToken: resetSessionToken,
            body: { email: resetUser.email }
        }, 401);
    });

    test("POST /v1/auth/reset-password with invalid token fails", async () => {
        await makeAPIRequest("/v1/auth/reset-password", {
            method: "POST",
            body: {
                reset_token: "invalid-token",
                new_password: "ResetP@ssw0rd1"
            }
        }, 400);
    });

    test("POST /v1/auth/reset-password updates credentials for a valid reset token", async () => {
        const validResetToken = `reset_${randomUUID().replace(/-/g, "")}`;
        const nextPassword = "ResetP@ssw0rd1";
        const wrongLoginIP = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
        const correctLoginIP = `203.0.114.${Math.floor(Math.random() * 200) + 1}`;

        await DB.instance().insert(DB.Tables.passwordResets).values({
            token: hashResetToken(validResetToken),
            user_id: resetUser.id,
            expires_at: Date.now() + 10 * 60 * 1000
        }).run();

        await makeAPIRequest("/v1/auth/reset-password", {
            method: "POST",
            body: {
                reset_token: validResetToken,
                new_password: nextPassword
            }
        }, 200);

        await makeAPIRequest("/v1/auth/session", {
            authToken: resetSessionToken
        }, 401);

        await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: {
                username: resetUser.username,
                password: resetUser.password
            },
            additionalOptions: {
                headers: {
                    "x-forwarded-for": wrongLoginIP
                }
            }
        }, 401);

        const login = await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: {
                username: resetUser.username,
                password: nextPassword
            },
            additionalOptions: {
                headers: {
                    "x-forwarded-for": correctLoginIP
                }
            },
            expectedBodySchema: AuthModel.Login.Response
        }, 200);

        expect(login.token.startsWith("dla_sess_")).toBe(true);
        resetUser.password = nextPassword;
    });
});

describe("Account routes", async () => {

    let session_token: string;
    
    beforeAll(async () => {
        session_token = await seedSession(testUser.id).then(s => s.token);
    });

    test("GET /v1/account returns current user", async () => {

        const data = await makeAPIRequest("/v1/account", {
            authToken: session_token,
            expectedBodySchema: AccountModel.GetInfo.Response
        });

        expect(data.id).toBe(testUser.id);
        expect(data.username).toBe(testUser.username);
        expect(data.display_name).toBe(testUser.display_name);
        expect(data.email).toBe(testUser.email);
        expect(data.role).toBe("user");
    });

    test("PUT /v1/account updates profile fields", async () => {
        
        const newUserData = {
            display_name: "Updated Name",
            username: "updatedusername",
            email: "updated@example.com",
            current_password: testUser.password
        }

        await makeAPIRequest("/v1/account", {
            method: "PUT",
            authToken: session_token,
            body: newUserData
        });

        testUser.display_name = newUserData.display_name;
        testUser.username = newUserData.username;
        testUser.email = newUserData.email;

        const dbresult = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.id, testUser.id)).get();

        expect(dbresult?.display_name).toBe(newUserData.display_name);
        expect(dbresult?.username).toBe(newUserData.username);
        expect(dbresult?.email).toBe(newUserData.email);
    });

    test("PUT /v1/account try updating role fails", async () => {
        
        await makeAPIRequest("/v1/account", {
            method: "PUT",
            authToken: session_token,
            body: { role: "admin" }
        }, 400);
        
        const dbresult = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.id, testUser.id)).get();
        expect(dbresult?.role).toBe("user");
    });

    test("PUT /v1/account/password rotates credentials and invalidates old sessions", async () => {

        const oldPassword = testUser.password;
        const newPassword = "NewP@ssw0rd1";

        await makeAPIRequest("/v1/account/password", {
            method: "PUT",
            authToken: session_token,
            body: {
                current_password: oldPassword,
                new_password: newPassword
            }
        });

        testUser.password = newPassword;

        // Old session should be invalidated
        await makeAPIRequest("/v1/account", {
            authToken: session_token,
        }, 401);

        // Login with old password should fail
        await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: oldPassword }
        }, 401);

        // Login with new password should succeed
        const data = await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: newPassword },
            expectedBodySchema: AuthModel.Login.Response
        });

        expect(data.token.startsWith("dla_sess_")).toBe(true);

        session_token = data.token;
    });

    test("DELETE /v1/account fails because of existing mail accounts", async () => {
        
        // Seed a mail account
        const mailAccountID = (await seedMailAccount(testUser.id)).id;

        await makeAPIRequest("/v1/account", {
            method: "DELETE",
            authToken: session_token
        }, 400);

        await DB.instance().delete(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.id, mailAccountID)
        ).run();
    });

    test("DELETE /v1/account removes user data", async () => {
        
        await makeAPIRequest("/v1/account", {
            method: "DELETE",
            authToken: session_token
        });

        const dbresult = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.id, testUser.id)).get();
        expect(dbresult).toBeUndefined();

        // recreate test user for further tests
        testUser = await seedUser("user", { username: "testuser" }, "UserP@ss1");
    });
});

describe("Account Preferences Routes", async () => {

    let preferencesTestUser: SeededUser;
    let session_token: string;

    beforeAll(async () => {
        preferencesTestUser = await seedUser("user", { username: "preferencesuser" }, "PrefsP@ss1");
        session_token = await seedSession(preferencesTestUser.id).then(s => s.token);
    });

    afterAll(async () => {
        SessionHandler.inValidateAllSessionsForUser(preferencesTestUser.id);

        DB.instance().delete(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, preferencesTestUser.id)
        ).run();

        DB.instance().delete(DB.Tables.users).where(
            eq(DB.Tables.users.id, preferencesTestUser.id)
        ).run();
    });

    test("GET /v1/account/preferences/remote-content-policy returns empty defaults when nothing is saved yet", async () => {

        const data = await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            authToken: session_token,
            expectedBodySchema: AccountPreferencesModel.RemoteContentPolicy.Response
        });

        expect(data.addresses).toEqual({});
        expect(data.domains).toEqual({});

        // No row should exist yet - this is a computed default, not a persisted one.
        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, preferencesTestUser.id)
        ).all();
        expect(dbresult.length).toBe(0);
    });

    test("GET /v1/account/preferences/remote-content-policy without auth fails", async () => {
        await makeAPIRequest("/v1/account/preferences/remote-content-policy", {}, 401);
    });

    test("PUT /v1/account/preferences/remote-content-policy saves a new policy", async () => {

        await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            method: "PUT",
            authToken: session_token,
            body: {
                addresses: { "sender@example.com": "allow" },
                domains: {}
            }
        });

        const data = await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            authToken: session_token,
            expectedBodySchema: AccountPreferencesModel.RemoteContentPolicy.Response
        });

        expect(data.addresses).toEqual({ "sender@example.com": "allow" });
        expect(data.domains).toEqual({});

        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, preferencesTestUser.id)
        ).all();
        expect(dbresult.length).toBe(1);
        expect(dbresult[0]?.key).toBe("remote-content-policy");
    });

    test("PUT /v1/account/preferences/remote-content-policy overwrites the previous policy without creating a duplicate row", async () => {

        await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            method: "PUT",
            authToken: session_token,
            body: {
                addresses: {},
                domains: { "example.com": "block" }
            }
        });

        const data = await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            authToken: session_token,
            expectedBodySchema: AccountPreferencesModel.RemoteContentPolicy.Response
        });

        // Replace semantics, not merge: the earlier "addresses" rule is gone.
        expect(data.addresses).toEqual({});
        expect(data.domains).toEqual({ "example.com": "block" });

        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, preferencesTestUser.id)
        ).all();
        expect(dbresult.length).toBe(1);
    });

    test("PUT /v1/account/preferences/remote-content-policy concurrently still results in exactly one stored row", async () => {

        await Promise.all([
            makeAPIRequest("/v1/account/preferences/remote-content-policy", {
                method: "PUT",
                authToken: session_token,
                body: { addresses: { "race1@example.com": "allow" }, domains: {} }
            }),
            makeAPIRequest("/v1/account/preferences/remote-content-policy", {
                method: "PUT",
                authToken: session_token,
                body: { addresses: { "race2@example.com": "block" }, domains: {} }
            })
        ]);

        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, preferencesTestUser.id)
        ).all();
        expect(dbresult.length).toBe(1);
    });

    test("PUT /v1/account/preferences/remote-content-policy with invalid decision fails", async () => {

        await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            method: "PUT",
            authToken: session_token,
            body: {
                addresses: { "sender@example.com": "maybe" },
                domains: {}
            }
        }, 400);
    });

    test("PUT /v1/account/preferences/remote-content-policy without auth fails", async () => {

        await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            method: "PUT",
            body: { addresses: {}, domains: {} }
        }, 401);
    });

    test("Preferences are isolated per user", async () => {

        const otherUser = await seedUser("user", { username: "preferencesotheruser" }, "OtherP@ss1");
        const otherSession = await seedSession(otherUser.id).then(s => s.token);

        const data = await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            authToken: otherSession,
            expectedBodySchema: AccountPreferencesModel.RemoteContentPolicy.Response
        });

        // Should NOT see preferencesTestUser's saved rules.
        expect(data.addresses).toEqual({});
        expect(data.domains).toEqual({});

        SessionHandler.inValidateAllSessionsForUser(otherUser.id);
        DB.instance().delete(DB.Tables.users).where(eq(DB.Tables.users.id, otherUser.id)).run();
    });

    test("DELETE /v1/account also removes stored preferences", async () => {

        const deletableUser = await seedUser("user", { username: "preferencesdeletableuser" }, "DeleteP@ss1");
        const deletableSession = await seedSession(deletableUser.id).then(s => s.token);

        await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            method: "PUT",
            authToken: deletableSession,
            body: { addresses: { "keep@example.com": "allow" }, domains: {} }
        });

        const beforeDelete = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, deletableUser.id)
        ).all();
        expect(beforeDelete.length).toBe(1);

        await makeAPIRequest("/v1/account", {
            method: "DELETE",
            authToken: deletableSession
        });

        const afterDelete = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, deletableUser.id)
        ).all();
        expect(afterDelete.length).toBe(0);
    });

    test("GET /v1/account/preferences/auto-mark-seen defaults to enabled=true with no stored row", async () => {

        const autoSeenUser = await seedUser("user", { username: "autoseenuser" }, "AutoP@ss1");
        const autoSeenSession = await seedSession(autoSeenUser.id).then(s => s.token);

        const data = await makeAPIRequest("/v1/account/preferences/auto-mark-seen", {
            authToken: autoSeenSession,
            expectedBodySchema: AccountPreferencesModel.AutoMarkSeen.Response
        });

        expect(data.enabled).toBe(true);

        // Default is computed, not persisted.
        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, autoSeenUser.id)
        ).all();
        expect(dbresult.length).toBe(0);

        SessionHandler.inValidateAllSessionsForUser(autoSeenUser.id);
        DB.instance().delete(DB.Tables.users).where(eq(DB.Tables.users.id, autoSeenUser.id)).run();
    });

    test("PUT /v1/account/preferences/auto-mark-seen persists enabled=false and reads it back", async () => {

        await makeAPIRequest("/v1/account/preferences/auto-mark-seen", {
            method: "PUT",
            authToken: session_token,
            body: { enabled: false }
        });

        const data = await makeAPIRequest("/v1/account/preferences/auto-mark-seen", {
            authToken: session_token,
            expectedBodySchema: AccountPreferencesModel.AutoMarkSeen.Response
        });

        expect(data.enabled).toBe(false);

        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            and(
                eq(DB.Tables.userPreferences.user_id, preferencesTestUser.id),
                eq(DB.Tables.userPreferences.key, "auto-mark-seen")
            )
        ).all();
        expect(dbresult.length).toBe(1);
    });

    test("GET /v1/account/preferences/auto-mark-seen without auth fails", async () => {
        await makeAPIRequest("/v1/account/preferences/auto-mark-seen", {}, 401);
    });

    test("GET /v1/account/preferences/folder-nesting defaults to nestUnderInbox=true with no stored row", async () => {

        const nestingUser = await seedUser("user", { username: "nestinguser" }, "NestP@ss1");
        const nestingSession = await seedSession(nestingUser.id).then(s => s.token);

        const data = await makeAPIRequest("/v1/account/preferences/folder-nesting", {
            authToken: nestingSession,
            expectedBodySchema: AccountPreferencesModel.FolderNesting.Response
        });

        expect(data.nestUnderInbox).toBe(true);

        // Default is computed, not persisted.
        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, nestingUser.id)
        ).all();
        expect(dbresult.length).toBe(0);

        SessionHandler.inValidateAllSessionsForUser(nestingUser.id);
        DB.instance().delete(DB.Tables.users).where(eq(DB.Tables.users.id, nestingUser.id)).run();
    });

    test("PUT /v1/account/preferences/folder-nesting persists nestUnderInbox=false and reads it back", async () => {

        await makeAPIRequest("/v1/account/preferences/folder-nesting", {
            method: "PUT",
            authToken: session_token,
            body: { nestUnderInbox: false }
        });

        const data = await makeAPIRequest("/v1/account/preferences/folder-nesting", {
            authToken: session_token,
            expectedBodySchema: AccountPreferencesModel.FolderNesting.Response
        });

        expect(data.nestUnderInbox).toBe(false);

        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            and(
                eq(DB.Tables.userPreferences.user_id, preferencesTestUser.id),
                eq(DB.Tables.userPreferences.key, "folder-nesting")
            )
        ).all();
        expect(dbresult.length).toBe(1);
    });

    test("GET /v1/account/preferences/folder-nesting without auth fails", async () => {
        await makeAPIRequest("/v1/account/preferences/folder-nesting", {}, 401);
    });

    test("GET /v1/account/preferences/folder-dnd defaults to enabled=false with no stored row", async () => {

        const dndUser = await seedUser("user", { username: "folderdnduser" }, "DndP@ss1");
        const dndSession = await seedSession(dndUser.id).then(s => s.token);

        const data = await makeAPIRequest("/v1/account/preferences/folder-dnd", {
            authToken: dndSession,
            expectedBodySchema: AccountPreferencesModel.FolderDnd.Response
        });

        expect(data.enabled).toBe(false);

        // Default is computed, not persisted.
        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, dndUser.id)
        ).all();
        expect(dbresult.length).toBe(0);

        SessionHandler.inValidateAllSessionsForUser(dndUser.id);
        DB.instance().delete(DB.Tables.users).where(eq(DB.Tables.users.id, dndUser.id)).run();
    });

    test("PUT /v1/account/preferences/folder-dnd persists enabled=true and reads it back", async () => {

        await makeAPIRequest("/v1/account/preferences/folder-dnd", {
            method: "PUT",
            authToken: session_token,
            body: { enabled: true }
        });

        const data = await makeAPIRequest("/v1/account/preferences/folder-dnd", {
            authToken: session_token,
            expectedBodySchema: AccountPreferencesModel.FolderDnd.Response
        });

        expect(data.enabled).toBe(true);

        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            and(
                eq(DB.Tables.userPreferences.user_id, preferencesTestUser.id),
                eq(DB.Tables.userPreferences.key, "folder-dnd")
            )
        ).all();
        expect(dbresult.length).toBe(1);
    });

    test("GET /v1/account/preferences/folder-dnd without auth fails", async () => {
        await makeAPIRequest("/v1/account/preferences/folder-dnd", {}, 401);
    });

    test("GET /v1/account/preferences returns every preference with defaults when nothing is saved yet", async () => {

        const allPrefsUser = await seedUser("user", { username: "allprefsdefaultuser" }, "AllP@ss1");
        const allPrefsSession = await seedSession(allPrefsUser.id).then(s => s.token);

        const data = await makeAPIRequest("/v1/account/preferences", {
            authToken: allPrefsSession,
            expectedBodySchema: AccountPreferencesModel.GetAll.Response
        });

        expect(Object.keys(data).sort()).toEqual(Object.keys(AccountPreferencesModel.GetAll.Response.shape).sort());
        expect(data).toMatchObject({
            "remote-content-policy": { addresses: {}, domains: {} },
            "auto-mark-seen": { enabled: true },
            "folder-nesting": { nestUnderInbox: true },
            "folder-dnd": { enabled: false },
            "onboarding": { completed: false },
        });

        // Defaults are computed, not persisted.
        const dbresult = DB.instance().select().from(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, allPrefsUser.id)
        ).all();
        expect(dbresult.length).toBe(0);

        SessionHandler.inValidateAllSessionsForUser(allPrefsUser.id);
        DB.instance().delete(DB.Tables.users).where(eq(DB.Tables.users.id, allPrefsUser.id)).run();
    });

    test("GET /v1/account/preferences returns saved values matching the per-preference routes", async () => {

        const allPrefsUser = await seedUser("user", { username: "allprefssaveduser" }, "AllP@ss1");
        const allPrefsSession = await seedSession(allPrefsUser.id).then(s => s.token);

        await makeAPIRequest("/v1/account/preferences/remote-content-policy", {
            method: "PUT",
            authToken: allPrefsSession,
            body: { addresses: { "news@example.com": "block" }, domains: { "example.com": "allow" } }
        });

        await makeAPIRequest("/v1/account/preferences/folder-dnd", {
            method: "PUT",
            authToken: allPrefsSession,
            body: { enabled: true }
        });

        const data = await makeAPIRequest("/v1/account/preferences", {
            authToken: allPrefsSession,
            expectedBodySchema: AccountPreferencesModel.GetAll.Response
        });

        expect(data["remote-content-policy"]).toEqual({ addresses: { "news@example.com": "block" }, domains: { "example.com": "allow" } });
        expect(data["folder-dnd"].enabled).toBe(true);
        // Unsaved preferences still fall back to their defaults.
        expect(data["auto-mark-seen"].enabled).toBe(true);

        for (const key of Object.keys(data)) {
            const single = await makeAPIRequest<unknown>(`/v1/account/preferences/${key}`, {
                authToken: allPrefsSession
            });
            expect(single).toEqual(data[key as keyof typeof data]);
        }

        SessionHandler.inValidateAllSessionsForUser(allPrefsUser.id);
        DB.instance().delete(DB.Tables.userPreferences).where(eq(DB.Tables.userPreferences.user_id, allPrefsUser.id)).run();
        DB.instance().delete(DB.Tables.users).where(eq(DB.Tables.users.id, allPrefsUser.id)).run();
    });

    test("GET /v1/account/preferences ignores stored keys that are no longer known preferences", async () => {

        const allPrefsUser = await seedUser("user", { username: "allprefslegacyuser" }, "AllP@ss1");
        const allPrefsSession = await seedSession(allPrefsUser.id).then(s => s.token);

        DB.instance().insert(DB.Tables.userPreferences).values({
            user_id: allPrefsUser.id,
            key: "legacy-preference",
            data: { some: "value" }
        }).run();

        // No expectedBodySchema: parsing would strip unknown keys and hide a leak.
        const data = await makeAPIRequest<Record<string, unknown>>("/v1/account/preferences", {
            authToken: allPrefsSession
        });

        expect(Object.keys(data)).not.toContain("legacy-preference");
        expect(Object.keys(data).sort()).toEqual(Object.keys(AccountPreferencesModel.GetAll.Response.shape).sort());

        SessionHandler.inValidateAllSessionsForUser(allPrefsUser.id);
        DB.instance().delete(DB.Tables.userPreferences).where(eq(DB.Tables.userPreferences.user_id, allPrefsUser.id)).run();
        DB.instance().delete(DB.Tables.users).where(eq(DB.Tables.users.id, allPrefsUser.id)).run();
    });

    test("GET /v1/account/preferences without auth fails", async () => {
        await makeAPIRequest("/v1/account/preferences", {}, 401);
    });

});

describe("Mail Account Routes", async () => {

    let mailAccountTestUser: SeededUser;
    let session_token: string;

    beforeAll(async () => {
        mailAccountTestUser = await seedUser("user", { username: "mailaccountuser" }, "MailAccP@ss1");
        session_token = await seedSession(mailAccountTestUser.id).then(s => s.token);
    });

    const mailAccountIDs: number[] = [];

    test("POST /v1/mail-accounts creates mail account", async () => {

        const mailAccountData = {
            display_name: "Test Mail Account",

            smtp_host: "127.0.0.1",
            smtp_port: 11125,
            smtp_encryption: "NONE",
            smtp_username: "testuser@example.com",
            smtp_password: "testpass",

            imap_host: "127.0.0.1",
            imap_port: 11143,
            imap_encryption: "NONE",
            imap_username: "testuser",
            imap_password: "testpass",

            is_default: false
        } satisfies MailAccountsModel.CreateMailAccount.Body;

        const data = await makeAPIRequest("/v1/mail-accounts", {
            method: "POST",
            authToken: session_token,
            body: mailAccountData,
            expectedBodySchema: MailAccountsModel.CreateMailAccount.Response
        });

        expect(data.id).toBeGreaterThan(0);

        const dbresult = DB.instance().select().from(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.id, data.id)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        const smtpData = MailAccountEncryption.decryptSMTPData(dbresult.smtp_encrypted_connection_data);
        const imapData = MailAccountEncryption.decryptIMAPData(dbresult.imap_encrypted_connection_data);

        expect(smtpData).toBeDefined();
        expect(imapData).toBeDefined();
        if (!smtpData || !imapData) {
            throw new Error("Failed to decrypt mail account data");
        }
        
        expect(smtpData.host).toBe(mailAccountData.smtp_host);
        expect(smtpData.port).toBe(mailAccountData.smtp_port);
        expect(smtpData.useSSL).toBe(mailAccountData.smtp_encryption);
        expect(smtpData.username).toBe(mailAccountData.smtp_username);
        expect(smtpData.password).toBe(mailAccountData.smtp_password);
        expect(imapData.host).toBe(mailAccountData.imap_host);
        expect(imapData.port).toBe(mailAccountData.imap_port);
        expect(imapData.useSSL).toBe(mailAccountData.imap_encryption);
        expect(imapData.username).toBe(mailAccountData.imap_username);
        expect(imapData.password).toBe(mailAccountData.imap_password);
        expect(dbresult.is_default).toBe(mailAccountData.is_default);

        // Every mail account must have at least one sender identity; without an
        // explicit one it is derived from the SMTP username.
        const identities = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.mail_account_id, data.id)
        ).all();

        expect(identities.length).toBe(1);
        expect(identities[0]?.email_address).toBe(mailAccountData.smtp_username);
        expect(identities[0]?.display_name).toBe(mailAccountData.display_name);
        expect(identities[0]?.is_default).toBe(true);

        mailAccountIDs.push(data.id);
    });

    // These two use their own user so the list assertions above keep seeing
    // exactly one account for `mailAccountTestUser`.
    test("POST /v1/mail-accounts creates the mail account with an explicit identity", async () => {

        const user = await seedUser("user", { username: `identityuser_${randomUUID().slice(0, 8)}` });
        const token = await seedSession(user.id).then(session => session.token);

        const mailAccountData = {
            display_name: "Explicit Identity Account",

            smtp_host: "127.0.0.1",
            smtp_port: 11125,
            smtp_encryption: "NONE",
            smtp_username: "login-name-only",
            smtp_password: "testpass",

            imap_host: "127.0.0.1",
            imap_port: 11143,
            imap_encryption: "NONE",
            imap_username: "testuser",
            imap_password: "testpass",

            is_default: false,

            identity: {
                display_name: "Explicit Sender",
                email_address: "explicit@example.com"
            }
        } satisfies MailAccountsModel.CreateMailAccount.Body;

        const data = await makeAPIRequest("/v1/mail-accounts", {
            method: "POST",
            authToken: token,
            body: mailAccountData,
            expectedBodySchema: MailAccountsModel.CreateMailAccount.Response
        });

        const identities = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.mail_account_id, data.id)
        ).all();

        expect(identities.length).toBe(1);
        expect(identities[0]?.email_address).toBe(mailAccountData.identity.email_address);
        expect(identities[0]?.display_name).toBe(mailAccountData.identity.display_name);
        expect(identities[0]?.is_default).toBe(true);
    });

    test("POST /v1/mail-accounts without a derivable sender identity fails", async () => {

        const user = await seedUser("user", { username: `noidentityuser_${randomUUID().slice(0, 8)}` });
        const token = await seedSession(user.id).then(session => session.token);

        const mailAccountData = {
            display_name: "No Identity Account",

            smtp_host: "127.0.0.1",
            smtp_port: 11125,
            smtp_encryption: "NONE",
            smtp_username: "login-name-only",
            smtp_password: "testpass",

            imap_host: "127.0.0.1",
            imap_port: 11143,
            imap_encryption: "NONE",
            imap_username: "testuser",
            imap_password: "testpass",

            is_default: false
        } satisfies MailAccountsModel.CreateMailAccount.Body;

        const accountsBefore = DB.instance().select().from(DB.Tables.mailAccounts).all().length;

        await makeAPIRequest("/v1/mail-accounts", {
            method: "POST",
            authToken: token,
            body: mailAccountData
        }, 400);

        // The account must not be created without its identity.
        expect(DB.instance().select().from(DB.Tables.mailAccounts).all().length).toBe(accountsBefore);
    });

    test("GET /v1/mail-accounts retrieves mail accounts", async () => {

        const data = await makeAPIRequest("/v1/mail-accounts", {
            authToken: session_token,
            expectedBodySchema: MailAccountsModel.GetAllMailAccounts.BaseResponse
        });

        expect(Array.isArray(data)).toBe(true);

        const dbresults = DB.instance().select().from(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.owner_user_id, mailAccountTestUser.id)
        ).orderBy(desc(DB.Tables.mailAccounts.id)).all();

        expect(data.length).toBe(dbresults.length);

        expect(data[0]).toBeDefined();
        if (!data[0]) return;

        expect(dbresults[0]).toBeDefined();
        if (!dbresults[0]) return;

        const decryptedSMTPData = MailAccountEncryption.decryptSMTPData(dbresults[0].smtp_encrypted_connection_data);
        const decryptedIMAPData = MailAccountEncryption.decryptIMAPData(dbresults[0].imap_encrypted_connection_data);

        if (!decryptedSMTPData || !decryptedIMAPData) {
            throw new Error("Failed to decrypt mail account data");
        }

        expect(data[0].id).toBe(dbresults[0]?.id);
        expect(data[0].smtp_host).toBe(decryptedSMTPData.host);
        expect(data[0].imap_host).toBe(decryptedIMAPData.host);
        expect(data[0].created_at).toBe(dbresults[0]?.created_at);
        expect(data[0].smtp_port).toBe(decryptedSMTPData.port);
        expect(data[0].smtp_encryption).toBe(decryptedSMTPData.useSSL);
        expect(data[0].smtp_username).toBe(decryptedSMTPData.username);
        expect(data[0].imap_port).toBe(decryptedIMAPData.port);
        expect(data[0].imap_encryption).toBe(decryptedIMAPData.useSSL);
        expect(data[0].imap_username).toBe(decryptedIMAPData.username);
    });

    test("GET /v1/mail-accounts?withMailboxes=true retrieves mail accounts with mailboxes", async () => {

        const data = await makeAPIRequest("/v1/mail-accounts?withMailboxes=true", {
            authToken: session_token,
            expectedBodySchema: MailAccountsModel.GetAllMailAccounts.ResponseWithMailboxes,
        });

        expect(Array.isArray(data)).toBe(true);

        const dbresults = DB.instance().select().from(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.owner_user_id, mailAccountTestUser.id)
        ).orderBy(desc(DB.Tables.mailAccounts.id)).all();

        expect(data.length).toBe(dbresults.length);

        expect(data[0]).toBeDefined();
        if (!data[0]) return;

        const dbresult = dbresults[0];

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        const decryptedSMTPData = MailAccountEncryption.decryptSMTPData(dbresult.smtp_encrypted_connection_data);
        const decryptedIMAPData = MailAccountEncryption.decryptIMAPData(dbresult.imap_encrypted_connection_data);

        if (!decryptedSMTPData || !decryptedIMAPData) {
            throw new Error("Failed to decrypt mail account data");
        }

        expect(data[0].id).toBe(dbresult.id);
        expect(data[0].smtp_host).toBe(decryptedSMTPData.host);
        expect(data[0].smtp_port).toBe(decryptedSMTPData.port);
        expect(data[0].smtp_encryption).toBe(decryptedSMTPData.useSSL);
        expect(data[0].smtp_username).toBe(decryptedSMTPData.username);
        expect(data[0].imap_host).toBe(decryptedIMAPData.host);
        expect(data[0].imap_port).toBe(decryptedIMAPData.port);
        expect(data[0].imap_encryption).toBe(decryptedIMAPData.useSSL);
        expect(data[0].imap_username).toBe(decryptedIMAPData.username);

        expect(Array.isArray(data[0].mailboxes)).toBe(true);
        
        expect(data[0].mailboxes.find(mb => mb.name === "INBOX")).toBeDefined();
        expect(data[0].mailboxes.find(mb => mb.path === "INBOX/Privat" && mb.name === "Privat")).toBeDefined();
        expect(data[0].mailboxes.find(mb => mb.path === "INBOX/Work" && mb.name === "Work")).toBeDefined();
        expect(data[0].mailboxes.find(mb => mb.name === "Sent")).toBeDefined();
        expect(data[0].mailboxes.find(mb => mb.name === "Drafts")).toBeDefined();
        expect(data[0].mailboxes.find(mb => mb.name === "Spam")).toBeDefined();
        expect(data[0].mailboxes.find(mb => mb.name === "Trash")).toBeDefined();

        const inbox = data[0].mailboxes.find(f => f.name === "INBOX");
        expect(inbox).toBeDefined();
        if (!inbox) return;

        expect(inbox.name).toBe("INBOX");
        expect(inbox.path).toBe("INBOX");
        expect(inbox.flags).toBeArray();
        expect(inbox.delimiter).toBe("/");
        expect(inbox.parent.length).toBe(0);
        expect(inbox.parentPath).toBe("");

    });

    test("Get /v1/mail-accounts/:mailAccountID retrieves specific mail account", async () => {

        const mailAccountID = mailAccountIDs[0];
        expect(mailAccountID).toBeNumber();
        if (!mailAccountID) return;

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}`, {
            authToken: session_token,
            expectedBodySchema: MailAccountsModel.GetMailAccountByID.Response
        });

        expect(data).toBeDefined();
        if (!data) return;

        expect(data.id).toBe(mailAccountID);

        const dbresult = DB.instance().select().from(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.id, mailAccountID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        const decryptedSMTPData = MailAccountEncryption.decryptSMTPData(dbresult.smtp_encrypted_connection_data);
        const decryptedIMAPData = MailAccountEncryption.decryptIMAPData(dbresult.imap_encrypted_connection_data);

        if (!decryptedSMTPData || !decryptedIMAPData) {
            throw new Error("Failed to decrypt mail account data");
        }

        expect(data.smtp_host).toBe(decryptedSMTPData.host);
        expect(data.smtp_port).toBe(decryptedSMTPData.port);
        expect(data.smtp_encryption).toBe(decryptedSMTPData.useSSL);
        expect(data.smtp_username).toBe(decryptedSMTPData.username);
        expect(data.imap_host).toBe(decryptedIMAPData.host);
        expect(data.imap_port).toBe(decryptedIMAPData.port);
        expect(data.imap_encryption).toBe(decryptedIMAPData.useSSL);
        expect(data.imap_username).toBe(decryptedIMAPData.username);
    });

    test("Get /v1/mail-accounts/:mailAccountID?withMailboxes=true retrieves specific mail account with mailboxes", async () => {

        const mailAccountID = mailAccountIDs[0];
        expect(mailAccountID).toBeNumber();
        if (!mailAccountID) return;

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}?withMailboxes=true`, {
            authToken: session_token,
            expectedBodySchema: MailAccountsModel.GetMailAccountByID.ResponseWithMailboxes
        });

        expect(data).toBeDefined();
        if (!data) return;

        expect(data.id).toBe(mailAccountID);
        expect(Array.isArray(data.mailboxes)).toBe(true);

        expect(data.mailboxes.find(mb => mb.name === "INBOX")).toBeDefined();
        expect(data.mailboxes.find(mb => mb.path === "INBOX/Privat" && mb.name === "Privat")).toBeDefined();
        expect(data.mailboxes.find(mb => mb.path === "INBOX/Work" && mb.name === "Work")).toBeDefined();
        expect(data.mailboxes.find(mb => mb.name === "Sent")).toBeDefined();
        expect(data.mailboxes.find(mb => mb.name === "Drafts")).toBeDefined();
        expect(data.mailboxes.find(mb => mb.name === "Spam")).toBeDefined();
        expect(data.mailboxes.find(mb => mb.name === "Trash")).toBeDefined();

        const inbox = data.mailboxes.find(f => f.name === "INBOX");
        expect(inbox).toBeDefined();
        if (!inbox) return;
        
        expect(inbox.name).toBe("INBOX");
        expect(inbox.path).toBe("INBOX");
        expect(inbox.flags).toBeArray();
        expect(inbox.delimiter).toBe("/");
        expect(inbox.parent.length).toBe(0);
        expect(inbox.parentPath).toBe("");
    });

    test("Get /v1/mail-accounts/:mailAccountID with invalid ID fails", async () => {
        
        const invalidMailAccountID = 999999;

        await makeAPIRequest(`/v1/mail-accounts/${invalidMailAccountID}`, {
            authToken: session_token
        }, 404);
    });

    test("PUT /v1/mail-accounts/:mailAccountID updates mail account info", async () => {

        const mailAccountID = mailAccountIDs[0];
        expect(mailAccountID).toBeNumber();
        if (!mailAccountID) return;

        const updatedData = {
            display_name: "Updated Mail Account",
            is_default: true
        } satisfies MailAccountsModel.UpdateMailAccountInfo.Body;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        });

        const dbresult = DB.instance().select().from(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.id, mailAccountID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(dbresult.display_name).toBe(updatedData.display_name);
        expect(dbresult.is_default).toBe(updatedData.is_default);
    });

    test("PUT /v1/mail-accounts/:mailAccountID with invalid ID fails", async () => {

        const invalidMailAccountID = 999999;

        const updatedData = {
            display_name: "Updated Mail Account",
            is_default: true
        } satisfies MailAccountsModel.UpdateMailAccountInfo.Body;

        await makeAPIRequest(`/v1/mail-accounts/${invalidMailAccountID}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        }, 404);
    });

    test("PUT /v1/mail-accounts/:mailAccountID/credentials updates specific mail account", async () => {

        const mailAccountID = mailAccountIDs[0];
        expect(mailAccountID).toBeNumber();
        if (!mailAccountID) return;

        const updatedData = {
            smtp_host: "smtp.updated.com",
            smtp_port: 465,
            smtp_encryption: "SSL" as const,
            smtp_username: "updatedsmtpuser",
            smtp_password: "updatedsmtppass",

            imap_host: "imap.updated.com",
            imap_port: 993,
            imap_encryption: "SSL" as const,
            imap_username: "updatedimapuser",
            imap_password: "updatedimappass",
        } satisfies MailAccountsModel.UpdateMailAccountCredentials.Body;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/credentials`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        });

        const dbresult = DB.instance().select().from(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.id, mailAccountID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        const smtpData = MailAccountEncryption.decryptSMTPData(dbresult.smtp_encrypted_connection_data);
        const imapData = MailAccountEncryption.decryptIMAPData(dbresult.imap_encrypted_connection_data);

        expect(smtpData).toBeDefined();
        expect(imapData).toBeDefined();
        if (!smtpData || !imapData) return;

        expect(smtpData.host).toBe(updatedData.smtp_host);
        expect(smtpData.port).toBe(updatedData.smtp_port);
        expect(smtpData.useSSL).toBe(updatedData.smtp_encryption);
        expect(smtpData.username).toBe(updatedData.smtp_username);
        expect(smtpData.password).toBe(updatedData.smtp_password);

        expect(imapData.host).toBe(updatedData.imap_host);
        expect(imapData.port).toBe(updatedData.imap_port);
        expect(imapData.useSSL).toBe(updatedData.imap_encryption);
        expect(imapData.username).toBe(updatedData.imap_username);
        expect(imapData.password).toBe(updatedData.imap_password);
    });

    test("PUT /v1/mail-accounts/:mailAccountID/credentials with invalid ID fails", async () => {
        
        const invalidMailAccountID = 999999;

        const updatedData = {
            smtp_host: "smtp.updated.com",
            smtp_port: 465,
            smtp_encryption: "SSL" as const,
            smtp_username: "updatedsmtpuser",
            smtp_password: "updatedsmtppass",

            imap_host: "imap.updated.com",
            imap_port: 993,
            imap_encryption: "SSL" as const,
            imap_username: "updatedimapuser",
            imap_password: "updatedimappass",
        } satisfies MailAccountsModel.UpdateMailAccountCredentials.Body;

        await makeAPIRequest(`/v1/mail-accounts/${invalidMailAccountID}/credentials`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        }, 404);
    });

    test("DELETE /v1/mail-accounts/:mailAccountID deletes specific mail account", async () => {

        const mailAccountID = mailAccountIDs[0];
        expect(mailAccountID).toBeNumber();
        if (!mailAccountID) return;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}`, {
            method: "DELETE",
            authToken: session_token,
        });

        const dbresult = DB.instance().select().from(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.id, mailAccountID)
        ).get();

        expect(dbresult).toBeUndefined();
    });

    test("DELETE /v1/mail-accounts/:mailAccountID with invalid ID fails", async () => {
        
        const invalidMailAccountID = 999999;

        await makeAPIRequest(`/v1/mail-accounts/${invalidMailAccountID}`, {
            method: "DELETE",
            authToken: session_token,
        }, 404);
    });

    afterAll(async () => {
        SessionHandler.inValidateAllSessionsForUser(mailAccountTestUser.id);

        DB.instance().delete(DB.Tables.users).where(
            eq(DB.Tables.users.id, mailAccountTestUser.id)
        ).run();
    });

});

describe("Mail Identity Routes", async () => {

    let mailIdentityTestUser: SeededUser;
    let session_token: string;
    let mailAccountID: number;

    beforeAll(async () => {
        mailIdentityTestUser = await seedUser("user", { username: "mailidentityuser" }, "MailIdentP@ss1");
        session_token = await seedSession(mailIdentityTestUser.id).then(s => s.token);

        mailAccountID = (await seedMailAccount(mailIdentityTestUser.id)).id;
    });
    
    const mailIdentityIDs: number[] = [];

    test("POST /v1/mail-accounts/:mailAccountID/identities creates mail identity", async () => {

        const mailIdentityData = {
            display_name: "Test Identity",
            email_address: "test@example.com",
            is_default: false
        } satisfies MailIdentitiesModel.CreateMailIdentity.Body;

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities`, {
            method: "POST",
            authToken: session_token,
            body: mailIdentityData,
            expectedBodySchema: MailIdentitiesModel.CreateMailIdentity.Response
        });

        expect(data.id).toBeGreaterThan(0);

        const dbresult = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, data.id)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(dbresult.display_name).toBe(mailIdentityData.display_name);
        expect(dbresult.email_address).toBe(mailIdentityData.email_address);
        expect(dbresult.is_default).toBe(mailIdentityData.is_default);

        mailIdentityIDs.push(data.id);
    });

    test("GET /v1/mail-accounts/:mailAccountID/identities retrieves mail identities", async () => {

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities`, {
            authToken: session_token,
            expectedBodySchema: MailIdentitiesModel.GetAll.Response
        });

        expect(Array.isArray(data)).toBe(true);

        const dbresults = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.mail_account_id, mailAccountID)
        ).orderBy(desc(DB.Tables.mailIdentities.id)).all();

        expect(data.length).toBe(dbresults.length);

        expect(data[0]).toBeDefined();
        if (!data[0]) return;

        expect(dbresults[0]).toBeDefined();
        if (!dbresults[0]) return;

        expect(data[0].id).toBe(dbresults[0]?.id);
        expect(data[0].display_name).toBe(dbresults[0]?.display_name);
        expect(data[0].email_address).toBe(dbresults[0]?.email_address);

    });

    test("GET /v1/mail-accounts/:mailAccountID/identities/:mailIdentityID retrieves specific mail identity", async () => {

        const mailIdentityID = mailIdentityIDs[0];
        expect(mailIdentityID).toBeNumber();
        if (!mailIdentityID) return;

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${mailIdentityID}`, {
            authToken: session_token,
            expectedBodySchema: MailIdentitiesModel.GetByID.Response
        });

        expect(data).toBeDefined();
        if (!data) return;

        expect(data.id).toBe(mailIdentityID);

        const dbresult = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, mailIdentityID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(data.display_name).toBe(dbresult.display_name);
        expect(data.email_address).toBe(dbresult.email_address);
    });

    test("GET /v1/mail-accounts/:mailAccountID/identities/:mailIdentityID with invalid ID fails", async () => {
        
        const invalidMailIdentityID = 999999;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${invalidMailIdentityID}`, {
            authToken: session_token
        }, 404);

    });

    test("PUT /v1/mail-accounts/:mailAccountID/identities/:mailIdentityID updates specific mail identity", async () => {

        const mailIdentityID = mailIdentityIDs[0];
        expect(mailIdentityID).toBeNumber();
        if (!mailIdentityID) return;

        const updatedData = {
            display_name: "Updated Identity",
            email_address: "new@example.com",
            is_default: false
        } satisfies MailIdentitiesModel.CreateMailIdentity.Body;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${mailIdentityID}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        });

        const dbresult = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, mailIdentityID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(dbresult.display_name).toBe(updatedData.display_name);
        expect(dbresult.email_address).toBe(updatedData.email_address);
        expect(dbresult.is_default).toBe(updatedData.is_default);
    });

    test("PUT /v1/mail-accounts/:mailAccountID/identities/:mailIdentityID with invalid ID fails", async () => {
        
        const invalidMailIdentityID = 999999;

        const updatedData = {
            display_name: "Updated Identity",
            email_address: "new@example.com",
            is_default: false
        } satisfies MailIdentitiesModel.CreateMailIdentity.Body;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${invalidMailIdentityID}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        }, 404);
    });

    test("POST /v1/mail-accounts/:mailAccountID/identities stores a signature", async () => {

        const mailIdentityData = {
            display_name: "Signed Identity",
            email_address: "signed@example.com",
            is_default: false,
            signature: "<p>Jane Doe</p><p><a href=\"https://example.com\">example.com</a></p>"
        } satisfies MailIdentitiesModel.CreateMailIdentity.Body;

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities`, {
            method: "POST",
            authToken: session_token,
            body: mailIdentityData,
            expectedBodySchema: MailIdentitiesModel.CreateMailIdentity.Response
        });

        const dbresult = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, data.id)
        ).get();

        expect(dbresult?.signature).toBe(mailIdentityData.signature);

        // It comes back out through the read routes as stored.
        const fetched = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${data.id}`, {
            authToken: session_token,
            expectedBodySchema: MailIdentitiesModel.GetByID.Response
        });

        expect(fetched.signature).toBe(mailIdentityData.signature);

        // …and can be cleared again, which an omitted signature must not do.
        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${data.id}`, {
            method: "PUT",
            authToken: session_token,
            body: { display_name: "Signed Identity Renamed" } satisfies MailIdentitiesModel.UpdateMailIdentity.Body
        });

        expect(DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, data.id)
        ).get()?.signature).toBe(mailIdentityData.signature);

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${data.id}`, {
            method: "PUT",
            authToken: session_token,
            body: { signature: null } satisfies MailIdentitiesModel.UpdateMailIdentity.Body
        });

        expect(DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, data.id)
        ).get()?.signature).toBeNull();

        // Leave the account with the single identity the delete tests expect.
        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${data.id}`, {
            method: "DELETE",
            authToken: session_token
        });
    });

    test("POST /v1/mail-accounts/:mailAccountID/identities rejects an oversized signature", async () => {

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities`, {
            method: "POST",
            authToken: session_token,
            body: {
                display_name: "Too Wordy",
                email_address: "toowordy@example.com",
                is_default: false,
                signature: "x".repeat(16385)
            }
        }, 400);
    });

    test("DELETE /v1/mail-accounts/:mailAccountID/identities/:mailIdentityID refuses to delete the last identity", async () => {

        const mailIdentityID = mailIdentityIDs[0];
        expect(mailIdentityID).toBeNumber();
        if (!mailIdentityID) return;

        // A mail account must keep at least one address to send from.
        expect(DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.mail_account_id, mailAccountID)
        ).all().length).toBe(1);

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${mailIdentityID}`, {
            method: "DELETE",
            authToken: session_token,
        }, 409);

        expect(DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, mailIdentityID)
        ).get()).toBeDefined();
    });

    test("DELETE /v1/mail-accounts/:mailAccountID/identities/:mailIdentityID deletes specific mail identity and hands the default on", async () => {

        const mailIdentityID = mailIdentityIDs[0];
        expect(mailIdentityID).toBeNumber();
        if (!mailIdentityID) return;

        // Make the identity under test the default, so its deletion has a default
        // to pass on, and add a second one so it may be deleted at all.
        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${mailIdentityID}`, {
            method: "PUT",
            authToken: session_token,
            body: { is_default: true } satisfies MailIdentitiesModel.UpdateMailIdentity.Body
        });

        const secondIdentity = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities`, {
            method: "POST",
            authToken: session_token,
            body: {
                display_name: "Second Identity",
                email_address: "second@example.com",
                is_default: false
            } satisfies MailIdentitiesModel.CreateMailIdentity.Body,
            expectedBodySchema: MailIdentitiesModel.CreateMailIdentity.Response
        });

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${mailIdentityID}`, {
            method: "DELETE",
            authToken: session_token,
        });

        const dbresult = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, mailIdentityID)
        ).get();

        expect(dbresult).toBeUndefined();

        // The remaining identity takes over as the account's default.
        const remaining = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, secondIdentity.id)
        ).get();

        expect(remaining).toBeDefined();
        expect(remaining?.is_default).toBe(true);
    });

    test("DELETE /v1/mail-accounts/:mailAccountID/identities/:mailIdentityID with invalid ID fails", async () => {
        
        const invalidMailIdentityID = 999999;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${invalidMailIdentityID}`, {
            method: "DELETE",
            authToken: session_token,
        }, 404);
    
    });

    afterAll(async () => {

        SessionHandler.inValidateAllSessionsForUser(mailIdentityTestUser.id);

        DB.instance().delete(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.id, mailAccountID)
        ).run();

        DB.instance().delete(DB.Tables.users).where(
            eq(DB.Tables.users.id, mailIdentityTestUser.id)
        ).run();
    });
});

describe("Mail Identity Backfill Migration", async () => {

    // The shipped migration, run against rows that look like they predate it.
    // Referenced by name on purpose: renaming the file should fail this loudly
    // rather than quietly testing nothing.
    const MIGRATION_FILE = "drizzle/migrations/sqlite/0014_backfill_default_mail_identities.sql";

    let backfillTestUser: SeededUser;

    // Accounts as they existed before identities were mandatory: without one.
    let accountWithoutIdentity: number;
    let accountWithIdentity: number;
    let existingIdentityID: number;

    async function runMigration() {
        const sql = await Bun.file(MIGRATION_FILE).text();
        for (const statement of sql.split("--> statement-breakpoint")) {
            if (statement.trim() === "") continue;
            DB.instance().$client.exec(statement);
        }
    }

    beforeAll(async () => {

        backfillTestUser = await seedUser("user", { username: "identitybackfilluser", email: "owner@example.com" }, "BackfillP@ss1");

        accountWithoutIdentity = (await seedMailAccount(backfillTestUser.id)).id;
        accountWithIdentity = (await seedMailAccount(backfillTestUser.id)).id;

        existingIdentityID = DB.instance().insert(DB.Tables.mailIdentities).values({
            mail_account_id: accountWithIdentity,
            display_name: "Already Set Up",
            email_address: "already@example.com",
            is_default: true
        }).returning().get().id;
    });

    function identitiesOf(mailAccountID: number) {
        return DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.mail_account_id, mailAccountID)
        ).all();
    }

    test("gives an account without an identity one named after its owner's address", async () => {

        expect(identitiesOf(accountWithoutIdentity).length).toBe(0);

        await runMigration();

        const created = identitiesOf(accountWithoutIdentity);

        expect(created.length).toBe(1);
        // SQL cannot read the account's own (encrypted) SMTP username, so the
        // owner's account email is what the identity is built from.
        expect(created[0]?.email_address).toBe(backfillTestUser.email);
        expect(created[0]?.display_name).toBe(backfillTestUser.email);
        expect(created[0]?.created_at).toBeGreaterThan(0);
    });

    test("does not preselect the backfilled address for sending", async () => {

        expect(identitiesOf(accountWithoutIdentity)[0]?.is_default).toBe(false);
    });

    test("leaves an account that already has an identity untouched", async () => {

        const identities = identitiesOf(accountWithIdentity);

        expect(identities.length).toBe(1);
        expect(identities[0]?.id).toBe(existingIdentityID);
        expect(identities[0]?.display_name).toBe("Already Set Up");
        expect(identities[0]?.email_address).toBe("already@example.com");
    });

    test("is idempotent", async () => {

        await runMigration();

        expect(identitiesOf(accountWithoutIdentity).length).toBe(1);
        expect(identitiesOf(accountWithIdentity).length).toBe(1);
    });

    test("leaves every account with at least one identity", async () => {

        const accountsWithoutIdentity = DB.instance().select().from(DB.Tables.mailAccounts).all()
            .filter((account) => identitiesOf(account.id).length === 0);

        expect(accountsWithoutIdentity).toEqual([]);
    });

    afterAll(async () => {

        SessionHandler.inValidateAllSessionsForUser(backfillTestUser.id);

        for (const mailAccountID of [accountWithoutIdentity, accountWithIdentity]) {
            DB.instance().delete(DB.Tables.mailIdentities).where(
                eq(DB.Tables.mailIdentities.mail_account_id, mailAccountID)
            ).run();
            DB.instance().delete(DB.Tables.mailAccounts).where(
                eq(DB.Tables.mailAccounts.id, mailAccountID)
            ).run();
        }

        DB.instance().delete(DB.Tables.users).where(
            eq(DB.Tables.users.id, backfillTestUser.id)
        ).run();
    });
});

describe("Mail Mailbox Routes", async () => {

    let mailIdentityTestUser: SeededUser;
    let session_token: string;
    let mailAccountID: number;
    let testIMAPClient: IMAPAccount;

    const connectionSettings = {
        smtp_host: "127.0.0.1",
        smtp_port: 11125,
        smtp_encryption: "NONE",
        smtp_username: "testuser",
        smtp_password: "testpass",

        imap_host: "127.0.0.1",
        imap_port: 11143,
        imap_encryption: "NONE",
        imap_username: "testuser",
        imap_password: "testpass"
    } as const;

    beforeAll(async () => {

        mailIdentityTestUser = await seedUser("user", { username: "mailfoldersuser" }, "MailFoldP@ss1");
        session_token = await seedSession(mailIdentityTestUser.id).then(s => s.token);

        testIMAPClient = await IMAPAccount.fromConfig({
            host: connectionSettings.imap_host,
            port: connectionSettings.imap_port,
            username: connectionSettings.imap_username,
            password: connectionSettings.imap_password,
            useSSL: connectionSettings.imap_encryption
        }).connect();

        const encryptedSMTPData = MailAccountEncryption.encryptSMTPData({
            host: connectionSettings.smtp_host,
            port: connectionSettings.smtp_port,
            username: connectionSettings.smtp_username,
            password: connectionSettings.smtp_password,
            useSSL: connectionSettings.smtp_encryption
        });

        const encryptedIMAPData = MailAccountEncryption.encryptIMAPData({
            host: connectionSettings.imap_host,
            port: connectionSettings.imap_port,
            username: connectionSettings.imap_username,
            password: connectionSettings.imap_password,
            useSSL: connectionSettings.imap_encryption
        });
        
        if (!encryptedSMTPData || !encryptedIMAPData) {
            throw new Error("Failed to encrypt mail account data");
        }

        mailAccountID = DB.instance().insert(DB.Tables.mailAccounts).values({
            owner_user_id: mailIdentityTestUser.id,
            display_name: "Test Mail Account",
            smtp_encrypted_connection_data: encryptedSMTPData,
            imap_encrypted_connection_data: encryptedIMAPData
        }).returning().get().id;

    });
    
    test("POST /v1/mail-accounts/:mailAccountID/mailboxes creates new mailbox / folder", async () => {

        const mailboxData = {
            path: "INBOX/Social Media",
        } satisfies MailboxesModel.Create.Body;

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes`, {
            method: "POST",
            authToken: session_token,
            body: mailboxData
        });

        expect(data).toBeNull();

        expect(await testIMAPClient.getMailbox(mailboxData.path)).not.toBeNull();
    });

    test("GET /v1/mail-accounts/:mailAccountID/mailboxes retrieves mail mailboxes", async () => {

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes`, {
            authToken: session_token,
            expectedBodySchema: MailboxesModel.GetAll.Response
        });

        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);

        expect(data.find(mb => mb.name === "INBOX")).toBeDefined();
        expect(data.find(mb => mb.path === "INBOX/Privat" && mb.name === "Privat")).toBeDefined();
        expect(data.find(mb => mb.path === "INBOX/Work" && mb.name === "Work")).toBeDefined();
        expect(data.find(mb => mb.name === "Sent")).toBeDefined();
        expect(data.find(mb => mb.name === "Drafts")).toBeDefined();
        expect(data.find(mb => mb.name === "Spam")).toBeDefined();
        expect(data.find(mb => mb.name === "Trash")).toBeDefined();

        const inbox = data.find(f => f.name === "INBOX");
        expect(inbox).toBeDefined();
        if (!inbox) return;

        expect(inbox.name).toBe("INBOX");
        expect(inbox.path).toBe("INBOX");
        expect(inbox.flags).toBeArray();
        expect(inbox.delimiter).toBe("/");
        expect(inbox.parent.length).toBe(0);
        expect(inbox.parentPath).toBe("");
    });

    test("GET /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath retrieves specific mail mailbox", async () => {

        const mailboxPath = "INBOX/Social Media";

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/${encodeURIComponent(mailboxPath)}`, {
            authToken: session_token,
            expectedBodySchema: MailboxesModel.GetByPath.Response
        });

        expect(data).toBeDefined();
        if (!data) return;

        expect(data.name).toBe("Social Media");
        expect(data.path).toBe("INBOX/Social Media");
        expect(data.flags).toBeArray();
        expect(data.delimiter).toBe("/");
        expect(data.parent[0]).toBe("INBOX");
        expect(data.parentPath).toBe("INBOX");
    });

    test("GET /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath with invalid path fails", async () => {
        
        const invalidMailboxPath = "NONEXISTENT";

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/${encodeURIComponent(invalidMailboxPath)}`, {
            authToken: session_token
        }, 404);

    });

    test("PUT /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath updates specific mail mailbox", async () => {

        const newMailboxPath = "INBOX/Socials";
        const oldMailboxPath = "INBOX/Social Media";

        const updatedData = {
            path: newMailboxPath
        } satisfies MailboxesModel.Update.Body;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/${encodeURIComponent(oldMailboxPath)}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        });
        // path does not change, only the name
        const updatedMailbox = await testIMAPClient.getMailbox(newMailboxPath);
        expect(updatedMailbox).not.toBeNull();
        if (!updatedMailbox) return;

        expect(updatedMailbox.name).toBe("Socials");
        expect(updatedMailbox.path).toBe(newMailboxPath);
    });

    test("PUT /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath with invalid path fails", async () => {
        
        const invalidMailboxPath = "NONEXISTENT";

        const updatedData = {
            path: "INBOX/DoesNotMatter"
        } satisfies MailboxesModel.Update.Body;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/${encodeURIComponent(invalidMailboxPath)}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        }, 404);

    });

    test("DELETE /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath deletes specific mail mailbox", async () => {

        const mailboxPath = "INBOX/Socials";

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/${encodeURIComponent(mailboxPath)}`, {
            method: "DELETE",
            authToken: session_token,
        });

        expect(await testIMAPClient.getMailbox(mailboxPath)).toBeNull();
    });

    test("DELETE /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath with invalid path fails", async () => {
        
        const invalidMailboxPath = "NONEXISTENT";

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/${encodeURIComponent(invalidMailboxPath)}`, {
            method: "DELETE",
            authToken: session_token,
        }, 404);

    });

    afterAll(async () => {
        await testIMAPClient.disconnect();
    })
});

describe("Mail Mailbox Mails Routes", async () => {

    let mailIdentityTestUser: SeededUser;
    let session_token: string;
    let mailAccountID: number;
    let testIMAPClient: IMAPAccount;

    const connectionSettings = {
        smtp_host: "127.0.0.1",
        smtp_port: 11125,
        smtp_encryption: "NONE",
        smtp_username: "testuser",
        smtp_password: "testpass",

        imap_host: "127.0.0.1",
        imap_port: 11143,
        imap_encryption: "NONE",
        imap_username: "testuser",
        imap_password: "testpass"
    } as const;

    beforeAll(async () => {

        mailIdentityTestUser = await seedUser("user", { username: "mailstestuser" }, "MailsTestP@ss1");
        session_token = await seedSession(mailIdentityTestUser.id).then(s => s.token);

        testIMAPClient = await IMAPAccount.fromConfig({
            host: connectionSettings.imap_host,
            port: connectionSettings.imap_port,
            username: connectionSettings.imap_username,
            password: connectionSettings.imap_password,
            useSSL: connectionSettings.imap_encryption
        }).connect();

        const encryptedSMTPData = MailAccountEncryption.encryptSMTPData({
            host: connectionSettings.smtp_host,
            port: connectionSettings.smtp_port,
            username: connectionSettings.smtp_username,
            password: connectionSettings.smtp_password,
            useSSL: connectionSettings.smtp_encryption
        });

        const encryptedIMAPData = MailAccountEncryption.encryptIMAPData({
            host: connectionSettings.imap_host,
            port: connectionSettings.imap_port,
            username: connectionSettings.imap_username,
            password: connectionSettings.imap_password,
            useSSL: connectionSettings.imap_encryption
        });
        
        if (!encryptedSMTPData || !encryptedIMAPData) {
            throw new Error("Failed to encrypt mail account data");
        }

        mailAccountID = DB.instance().insert(DB.Tables.mailAccounts).values({
            owner_user_id: mailIdentityTestUser.id,
            display_name: "Test Mail Account",
            smtp_encrypted_connection_data: encryptedSMTPData,
            imap_encrypted_connection_data: encryptedIMAPData
        }).returning().get().id;

    });

    afterAll(async () => {
        await testIMAPClient.disconnect();
    })

    let createdMailUID: number;
    let multipartDraftUID: number;

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails creates new draft mail", async () => {

        const mailData = {
            from: { name: "Test Sender", address: "sender@test.com" },
            to: [{ name: "Test Receiver", address: "receiver@test.com" }],
            cc: [],
            bcc: [],
            subject: "Test Draft Mail",
            body: { text: "This is a test draft mail body", html: "<p>This is a test draft mail body</p>" },
            flags: { draft: true }
        };

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
            method: "POST",
            authToken: session_token,
            body: mailData,
            expectedBodySchema: MailsModel.Create.Response
        });

        expect(data.uid).toBeGreaterThan(0);
        createdMailUID = data.uid;
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails stores multipart attachments", async () => {
        const form = new FormData();
        form.set("mail", JSON.stringify({
            from: { name: "Test Sender", address: "sender@test.com" },
            to: [{ name: "Test Receiver", address: "receiver@test.com" }],
            cc: [],
            bcc: [{ name: "Hidden Receiver", address: "hidden@test.com" }],
            subject: "Draft with attachment",
            body: { text: "See attachment" },
            flags: { draft: true }
        }));
        form.append("attachments", new File(["attachment body"], "note.txt", { type: "text/plain" }));

        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}` }, body: form }
        );
        expect(response.status).toBe(200);

        const created = await response.json() as { data: MailsModel.Create.Response };
        multipartDraftUID = created.data.uid;
        const attachmentData = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${created.data.uid}/attachments`,
            { authToken: session_token, expectedBodySchema: AttachmentsModel.GetAll.Response }
        );

        expect(attachmentData).toHaveLength(1);
        expect(attachmentData[0]).toMatchObject({ filename: "note.txt", contentType: "text/plain" });
        // The create response already reports what the attachment routes will see.
        expect(created.data.attachments).toEqual(attachmentData);

        const storedDraft = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${created.data.uid}`,
            { authToken: session_token, expectedBodySchema: MailsModel.GetByUID.Response }
        );
        expect(storedDraft.bcc).toEqual([{ name: "Hidden Receiver", address: "hidden@test.com" }]);
    });

    test("PUT content update preserves multipart draft attachments and Bcc", async () => {
        const updated = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${multipartDraftUID}`,
            {
                method: "PUT",
                authToken: session_token,
                body: { subject: "Updated draft with attachment" },
                expectedBodySchema: MailsModel.Update.Response
            }
        );

        expect(updated.newUid).toBeGreaterThan(0);
        multipartDraftUID = updated.newUid!;

        const attachments = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${multipartDraftUID}/attachments`,
            { authToken: session_token, expectedBodySchema: AttachmentsModel.GetAll.Response }
        );
        expect(attachments).toHaveLength(1);
        expect(attachments[0]).toMatchObject({ filename: "note.txt", contentType: "text/plain" });

        const attachmentResponse = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${multipartDraftUID}/attachments/0`,
            { headers: { Authorization: `Bearer ${session_token}` } }
        );
        expect(attachmentResponse.status).toBe(200);
        expect(await attachmentResponse.text()).toContain("attachment body");

        const storedDraft = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${multipartDraftUID}`,
            { authToken: session_token, expectedBodySchema: MailsModel.GetByUID.Response }
        );
        expect(storedDraft.subject).toBe("Updated draft with attachment");
        expect(storedDraft.bcc).toEqual([{ name: "Hidden Receiver", address: "hidden@test.com" }]);
    });

    test("PUT flag-only update keeps multipart draft UID and attachments", async () => {
        const originalUID = multipartDraftUID;
        const updated = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${originalUID}`,
            {
                method: "PUT",
                authToken: session_token,
                body: { flags: { flagged: true } },
                expectedBodySchema: MailsModel.Update.Response
            }
        );

        expect(updated.success).toBe(true);
        expect(updated.newUid).toBeUndefined();

        const storedDraft = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${originalUID}`,
            { authToken: session_token, expectedBodySchema: MailsModel.GetByUID.Response }
        );
        expect(storedDraft.uid).toBe(originalUID);
        expect(storedDraft.flags?.flagged).toBe(true);

        const attachments = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${originalUID}/attachments`,
            { authToken: session_token, expectedBodySchema: AttachmentsModel.GetAll.Response }
        );
        expect(attachments).toHaveLength(1);
        expect(attachments[0]?.filename).toBe("note.txt");
    });

    test("PUT flag-only update clears flags in place", async () => {
        const updated = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${multipartDraftUID}`,
            {
                method: "PUT",
                authToken: session_token,
                body: { flags: { flagged: false } },
                expectedBodySchema: MailsModel.Update.Response
            }
        );
        expect(updated.newUid).toBeUndefined();

        const storedDraft = await makeAPIRequest(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${multipartDraftUID}`,
            { authToken: session_token, expectedBodySchema: MailsModel.GetByUID.Response }
        );
        expect(storedDraft.flags?.flagged).toBe(false);
        expect(storedDraft.flags?.draft).toBe(true);
    });

    test("PUT content update keeps inline images and attachments without a disposition", async () => {
        const mixed = "INLINE-UPDATE-MIXED";
        const related = "INLINE-UPDATE-RELATED";
        const rawMessage = [
            "From: sender@test.com",
            "To: receiver@test.com",
            "Subject: Draft with inline image",
            "Message-ID: <inline-update-mixed@test.com>",
            `Content-Type: multipart/mixed; boundary="${mixed}"`,
            "",
            `--${mixed}`,
            `Content-Type: multipart/related; boundary="${related}"`,
            "",
            `--${related}`,
            "Content-Type: text/html; charset=utf-8",
            "",
            '<p>Logo: <img src="cid:logo@delivr"></p>',
            `--${related}`,
            "Content-Type: image/png; name=logo.png",
            "Content-Transfer-Encoding: base64",
            "Content-ID: <logo@delivr>",
            "Content-Disposition: inline; filename=logo.png",
            "",
            Buffer.from("fake png bytes").toString("base64"),
            `--${related}--`,
            `--${mixed}`,
            "Content-Type: application/octet-stream; name=nodisposition.bin",
            "Content-Transfer-Encoding: base64",
            "",
            Buffer.from("no disposition bytes").toString("base64"),
            `--${mixed}--`,
            ""
        ].join("\r\n");
        const uid = await testIMAPClient.createMail("INBOX", rawMessage, ["\\Draft"]);
        if (!uid) throw new Error("Failed to create inline-image test mail");

        let newUid: number | undefined;
        try {
            const updated = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, {
                method: "PUT",
                authToken: session_token,
                body: { subject: "Updated draft with inline image" },
                expectedBodySchema: MailsModel.Update.Response
            });
            newUid = updated.newUid;
            expect(newUid).toBeGreaterThan(0);

            const attachments = await makeAPIRequest(
                `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${newUid}/attachments`,
                { authToken: session_token, expectedBodySchema: AttachmentsModel.GetAll.Response }
            );
            expect(attachments).toContainEqual(expect.objectContaining({
                filename: "logo.png",
                contentId: "<logo@delivr>",
                contentDisposition: "inline"
            }));
            expect(attachments).toContainEqual(expect.objectContaining({
                filename: "nodisposition.bin",
                contentDisposition: "attachment"
            }));

            const storedDraft = await makeAPIRequest(
                `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${newUid}`,
                { authToken: session_token, expectedBodySchema: MailsModel.GetByUID.Response }
            );
            expect(storedDraft.body.html).toContain("cid:logo@delivr");
        } finally {
            if (newUid) {
                await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${newUid}?permanent=true`, {
                    method: "DELETE",
                    authToken: session_token
                });
            }
        }
    });

    /** Create an INBOX draft carrying `files` as attachments. */
    async function createDraftWithAttachments(subject: string, files: File[]) {
        const form = new FormData();
        form.set("mail", JSON.stringify({
            from: { address: "sender@test.com" },
            to: [{ address: "receiver@test.com" }],
            cc: [],
            bcc: [],
            subject,
            body: { text: `${subject} body` },
            flags: { draft: true }
        }));
        for (const file of files) form.append("attachments", file);

        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}` }, body: form }
        );
        expect(response.status).toBe(200);
        return (await response.json() as { data: MailsModel.Create.Response }).data;
    }

    function putInboxMail(uid: number, body: FormData | string) {
        return API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${session_token}`,
                    ...(typeof body === "string" ? { "Content-Type": "application/json" } : {})
                },
                body
            }
        );
    }

    async function inboxAttachmentText(uid: number, attachmentId: number) {
        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}/attachments/${attachmentId}`,
            { headers: { Authorization: `Bearer ${session_token}` } }
        );
        expect(response.status).toBe(200);
        return response.text();
    }

    function deleteInboxMail(uid: number) {
        return makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}?permanent=true`, {
            method: "DELETE",
            authToken: session_token
        });
    }

    test("PUT multipart adds attachments, keeps existing ones and removes the replaced version for good", async () => {
        const draft = await createDraftWithAttachments("Attachment update", [
            new File(["first body"], "first.txt", { type: "text/plain" })
        ]);

        const form = new FormData();
        form.set("mail", JSON.stringify({ subject: "Attachment update v2" }));
        form.append("attachments", new File(["second body"], "second.txt", { type: "text/plain" }));
        const response = await putInboxMail(draft.uid, form);
        expect(response.status).toBe(200);
        const { data } = await response.json() as { data: MailsModel.Update.Response };
        let trashedUid: number | undefined;

        try {
            expect(data.newUid).toBeGreaterThan(draft.uid);
            expect(data.attachments?.map(attachment => [attachment.id, attachment.filename])).toEqual([
                [0, "first.txt"],
                [1, "second.txt"]
            ]);
            expect(await inboxAttachmentText(data.newUid!, 0)).toBe("first body");
            expect(await inboxAttachmentText(data.newUid!, 1)).toBe("second body");

            // The replaced version is gone from the mailbox. This mock server has
            // no UIDPLUS, so it lands in Trash rather than being expunged — a
            // single-UID expunge isn't available there (see the UIDPLUS test in
            // mail-clients.test.ts).
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${draft.uid}`, { authToken: session_token }, 404);
            const trash = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/Trash/mails`, {
                authToken: session_token,
                expectedBodySchema: MailsModel.GetAll.Response
            });
            const replaced = trash.find(mail => mail.subject === "Attachment update");
            expect(replaced).toBeDefined();
            trashedUid = replaced!.uid;
        } finally {
            if (data.newUid) await deleteInboxMail(data.newUid);
            if (trashedUid !== undefined) {
                await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/Trash/mails/${trashedUid}?permanent=true`, {
                    method: "DELETE",
                    authToken: session_token
                });
            }
        }
    });

    test("PUT with a new body replaces both alternatives instead of keeping the old text part", async () => {
        const draft = await createDraftWithAttachments("Body alternatives", []);

        const response = await putInboxMail(draft.uid, JSON.stringify({
            body: { html: "<p>Rewritten in HTML</p>" }
        }));
        expect(response.status).toBe(200);
        const { data } = await response.json() as { data: MailsModel.Update.Response };

        try {
            const stored = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${data.newUid}`, {
                authToken: session_token,
                expectedBodySchema: MailsModel.GetByUID.Response
            });
            expect(stored.body?.html).toContain("Rewritten in HTML");
            // The superseded plain-text alternative must not survive, or plain-text
            // readers would still see the previous wording.
            expect(stored.body?.text ?? "").not.toContain("Body alternatives body");
        } finally {
            if (data.newUid) await deleteInboxMail(data.newUid);
        }
    });

    test("PUT does not carry \\Deleted onto the rebuilt draft", async () => {
        const draft = await createDraftWithAttachments("Deleted flag carry over", []);

        const flagged = await putInboxMail(draft.uid, JSON.stringify({ flags: { deleted: true } }));
        expect(flagged.status).toBe(200);

        const response = await putInboxMail(draft.uid, JSON.stringify({ subject: "Deleted flag carry over v2" }));
        expect(response.status).toBe(200);
        const { data } = await response.json() as { data: MailsModel.Update.Response };

        try {
            // The replacement is still there: had it inherited \\Deleted, removing
            // the version it replaced would have taken it along.
            const stored = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${data.newUid}`, {
                authToken: session_token,
                expectedBodySchema: MailsModel.GetByUID.Response
            });
            expect(stored.subject).toBe("Deleted flag carry over v2");
            expect(stored.flags?.deleted).toBe(false);
            expect(stored.flags?.draft).toBe(true);
        } finally {
            if (data.newUid) await deleteInboxMail(data.newUid);
        }
    });

    test("PUT removeAttachments drops the given attachments and keeps the rest", async () => {
        const draft = await createDraftWithAttachments("Attachment removal", [
            new File(["keep me"], "keep.txt", { type: "text/plain" }),
            new File(["drop me"], "drop.txt", { type: "text/plain" })
        ]);
        expect(draft.attachments.map(attachment => attachment.filename)).toEqual(["keep.txt", "drop.txt"]);

        const response = await putInboxMail(draft.uid, JSON.stringify({ removeAttachments: [1] }));
        expect(response.status).toBe(200);
        const { data } = await response.json() as { data: MailsModel.Update.Response };

        try {
            expect(data.attachments?.map(attachment => attachment.filename)).toEqual(["keep.txt"]);
            expect(await inboxAttachmentText(data.newUid!, 0)).toBe("keep me");

            // An attachment-only update leaves the content and flags as they were.
            const stored = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${data.newUid}`, {
                authToken: session_token,
                expectedBodySchema: MailsModel.GetByUID.Response
            });
            expect(stored.subject).toBe("Attachment removal");
            expect(stored.flags?.draft).toBe(true);
        } finally {
            if (data.newUid) await deleteInboxMail(data.newUid);
        }
    });

    test("PUT rejects unknown attachment ids and attachments over the combined limit", async () => {
        const draft = await createDraftWithAttachments("Attachment validation", [
            new File(["existing"], "existing.txt", { type: "text/plain" })
        ]);

        try {
            const unknown = await putInboxMail(draft.uid, JSON.stringify({ removeAttachments: [5] }));
            expect(unknown.status).toBe(400);
            await expect(unknown.json()).resolves.toMatchObject({ message: "Unknown attachment id(s): 5" });

            // Kept attachments count toward the limit together with the new files.
            const form = new FormData();
            form.set("mail", JSON.stringify({}));
            form.append("attachments", new File([new Uint8Array(25 * 1024 * 1024 - 4)], "big.bin", {
                type: "application/octet-stream"
            }));
            const tooLarge = await putInboxMail(draft.uid, form);
            expect(tooLarge.status).toBe(400);
            await expect(tooLarge.json()).resolves.toMatchObject({
                message: "Attachments exceed the maximum combined size of 25 MB"
            });

            // Neither request replaced the draft.
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${draft.uid}`, { authToken: session_token });
        } finally {
            await deleteInboxMail(draft.uid);
        }
    });

    test("PUT requests declaring a Content-Length over the limit are rejected before the body is read", async () => {
        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${multipartDraftUID}`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${session_token}`,
                    "Content-Type": "application/json",
                    "Content-Length": String(41 * 1024 * 1024 + 1)
                },
                body: "{}"
            }
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ message: "Request body exceeds the maximum size of 41 MB" });
    });

    test("POST create writes priority headers that are read back as the priority", async () => {
        for (const [priority, xPriority] of [["high", "1 (Highest)"], ["low", "5 (Lowest)"]] as const) {
            const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
                method: "POST",
                authToken: session_token,
                body: {
                    from: { address: "sender@test.com" },
                    to: [{ address: "receiver@test.com" }],
                    cc: [],
                    bcc: [],
                    subject: `Priority ${priority}`,
                    body: { text: "priority" },
                    priority
                },
                expectedBodySchema: MailsModel.Create.Response
            });

            try {
                const stored = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${created.uid}`, {
                    authToken: session_token,
                    expectedBodySchema: MailsModel.GetByUID.Response
                });
                expect(stored.priority).toBe(priority);
                expect(stored.rawHeaders["x-priority"]).toBe(`X-Priority: ${xPriority}`);
            } finally {
                await deleteInboxMail(created.uid);
            }
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails rejects multipart requests without mail data", async () => {
        const form = new FormData();
        form.append("attachments", new File(["attachment body"], "note.txt", { type: "text/plain" }));

        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}` }, body: form }
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ message: "Missing 'mail' field in multipart body" });
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails rejects invalid multipart mail JSON", async () => {
        const form = new FormData();
        form.set("mail", "{invalid json");

        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}` }, body: form }
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ message: "The 'mail' field is not valid JSON" });
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails rejects non-file attachment fields", async () => {
        const form = new FormData();
        form.set("mail", JSON.stringify({
            from: { address: "sender@test.com" },
            to: [{ address: "receiver@test.com" }],
            cc: [],
            bcc: [],
            body: { text: "Invalid attachment field" }
        }));
        form.set("attachments", "not-a-file");

        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}` }, body: form }
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ message: "Every 'attachments' field must contain a file" });
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails rejects attachments above the combined size limit", async () => {
        const form = new FormData();
        form.set("mail", JSON.stringify({
            from: { name: "Test Sender", address: "sender@test.com" },
            to: [{ name: "Test Receiver", address: "receiver@test.com" }],
            cc: [],
            bcc: [],
            subject: "Oversized attachment",
            body: { text: "This request must be rejected" },
            flags: { draft: true }
        }));
        form.append("attachments", new File([new Uint8Array(25 * 1024 * 1024 + 1)], "too-large.bin", {
            type: "application/octet-stream"
        }));

        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}` }, body: form }
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            message: "Attachments exceed the maximum combined size of 25 MB"
        });
    });

    test("Multipart total-size protection reports a request error for oversized mail JSON", async () => {
        const form = new FormData();
        form.set("mail", JSON.stringify({ body: { text: "x".repeat(41 * 1024 * 1024) } }));
        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}` }, body: form }
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            message: "Multipart request exceeds the maximum total size of 41 MB (mail JSON, attachments and framing combined)"
        });
    });

    test("JSON create requests are bounded by the same total-size limit", async () => {
        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            {
                method: "POST",
                headers: { Authorization: `Bearer ${session_token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ body: { text: "x".repeat(41 * 1024 * 1024) } })
            }
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            message: "Request body exceeds the maximum size of 41 MB"
        });
    });

    test("Create requests declaring a Content-Length over the limit are rejected before the body is read", async () => {
        const cases = [
            ["application/json", "Request body exceeds the maximum size of 41 MB"],
            ["multipart/form-data; boundary=unused", "Multipart request exceeds the maximum total size of 41 MB (mail JSON, attachments and framing combined)"]
        ] as const;

        for (const [contentType, message] of cases) {
            const response = await API.getApp().request(
                `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${session_token}`,
                        "Content-Type": contentType,
                        "Content-Length": String(41 * 1024 * 1024 + 1)
                    },
                    body: "{}"
                }
            );
            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toMatchObject({ message });
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails rejects malformed bodies", async () => {
        const post = (contentType: string, body: string) => API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}`, "Content-Type": contentType }, body }
        );

        const malformedJSON = await post("application/json", "{not json");
        expect(malformedJSON.status).toBe(400);
        await expect(malformedJSON.json()).resolves.toMatchObject({ message: "Malformed JSON body" });

        const malformedMultipart = await post("multipart/form-data; boundary=missing", "not multipart");
        expect(malformedMultipart.status).toBe(400);
        await expect(malformedMultipart.json()).resolves.toMatchObject({ message: "Malformed multipart/form-data body" });
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails rejects multipart mail JSON that fails validation", async () => {
        const form = new FormData();
        form.set("mail", JSON.stringify({ to: "not-a-list", body: { text: "invalid" } }));

        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}` }, body: form }
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ message: "Your input is invalid" });
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails reports a failed IMAP append as a server error", async () => {
        const createMailSpy = spyOn(IMAPAccount.prototype, "createMail").mockRejectedValueOnce(new Error("APPEND rejected"));

        try {
            const response = await API.getApp().request(
                `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
                {
                    method: "POST",
                    headers: { Authorization: `Bearer ${session_token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        from: { address: "sender@test.com" },
                        to: [{ address: "receiver@test.com" }],
                        cc: [],
                        bcc: [],
                        subject: "Append fails",
                        body: { text: "never stored" }
                    })
                }
            );

            expect(response.status).toBe(500);
            await expect(response.json()).resolves.toMatchObject({ message: "Failed to create mail" });
        } finally {
            createMailSpy.mockRestore();
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails returns uid 0 when the new UID is unknown", async () => {
        const createMailSpy = spyOn(IMAPAccount.prototype, "createMail").mockResolvedValueOnce(null);

        try {
            const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
                method: "POST",
                authToken: session_token,
                body: { to: [{ address: "receiver@test.com" }], cc: [], bcc: [], body: { text: "uid unknown" } },
                expectedBodySchema: MailsModel.Create.Response
            });
            expect(created.uid).toBe(0);
        } finally {
            createMailSpy.mockRestore();
        }
    });

    test("POST multipart attachments without a filename or content type get defaults", async () => {
        const boundary = "ATTACHMENT-DEFAULTS";
        const mail = JSON.stringify({
            from: { address: "sender@test.com" },
            to: [{ address: "receiver@test.com" }],
            cc: [],
            bcc: [],
            subject: "Attachments without name or type",
            body: { text: "defaults" },
            flags: { draft: true }
        });
        // Hand-written, because FormData always sends a filename and a content type.
        const body = [
            `--${boundary}`, 'Content-Disposition: form-data; name="mail"', "", mail,
            `--${boundary}`, 'Content-Disposition: form-data; name="attachments"; filename=""', "", "unnamed content",
            `--${boundary}`, 'Content-Disposition: form-data; name="attachments"; filename="untyped"', "", "untyped content",
            `--${boundary}--`, ""
        ].join("\r\n");

        const response = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            {
                method: "POST",
                headers: { Authorization: `Bearer ${session_token}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
                body
            }
        );
        expect(response.status).toBe(200);
        const { data } = await response.json() as { data: { uid: number } };

        try {
            const attachments = await makeAPIRequest(
                `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${data.uid}/attachments`,
                { authToken: session_token, expectedBodySchema: AttachmentsModel.GetAll.Response }
            );
            expect(attachments.map(a => [a.filename, a.contentType])).toEqual([
                ["attachment", "application/octet-stream"],
                ["untyped", "application/octet-stream"]
            ]);
        } finally {
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${data.uid}?permanent=true`, {
                method: "DELETE",
                authToken: session_token
            });
        }
    });

    test("PUT content update with partial flags preserves the draft's other flags", async () => {
        const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
            method: "POST",
            authToken: session_token,
            body: {
                from: { address: "sender@test.com" },
                to: [{ address: "receiver@test.com" }],
                cc: [],
                bcc: [],
                subject: "Draft to keep",
                body: { text: "keep me a draft" },
                flags: { draft: true }
            },
            expectedBodySchema: MailsModel.Create.Response
        });

        const updated = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${created.uid}`, {
            method: "PUT",
            authToken: session_token,
            body: { subject: "Draft still a draft", flags: { seen: true } },
            expectedBodySchema: MailsModel.Update.Response
        });
        expect(updated.newUid).toBeGreaterThan(0);

        const storedDraft = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${updated.newUid}`, {
            authToken: session_token,
            expectedBodySchema: MailsModel.GetByUID.Response
        });
        // The explicitly-set flag is applied and the pre-existing \Draft survives.
        expect(storedDraft.flags?.seen).toBe(true);
        expect(storedDraft.flags?.draft).toBe(true);

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${updated.newUid}?permanent=true`, {
            method: "DELETE",
            authToken: session_token
        });
    });

    test("PUT rejects the server-managed recent flag for both values", async () => {
        for (const recent of [true, false]) {
            await makeAPIRequest(
                `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${multipartDraftUID}`,
                { method: "PUT", authToken: session_token, body: { flags: { recent } } },
                400
            );
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails with invalid mailbox fails", async () => {

        const mailData = {
            from: { name: "Test Sender", address: "sender@test.com" },
            to: [{ name: "Test Receiver", address: "receiver@test.com" }],
            cc: [],
            bcc: [],
            subject: "Test Mail",
            body: { text: "Test body" }
        };

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/NONEXISTENT/mails`, {
            method: "POST",
            authToken: session_token,
            body: mailData
        }, 404);
    });

    test("GET /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID retrieves specific mail", async () => {

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${createdMailUID}`, {
            authToken: session_token,
            expectedBodySchema: MailsModel.GetByUID.Response
        });

        expect(data.uid).toBe(createdMailUID);
        expect(data.subject).toBe("Test Draft Mail");
        expect(data.from?.address).toBe("sender@test.com");
        expect(data.to[0]?.address).toBe("receiver@test.com");
        expect(data.body?.text).toContain("This is a test draft mail body");
    });

    test("GET /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID with invalid UID fails", async () => {

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/999999`, {
            authToken: session_token
        }, 404);
    });

    test("PUT /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID updates mail", async () => {

        const updateData = {
            subject: "Updated Test Draft Mail",
            body: { text: "Updated body content", html: "<p>Updated body content</p>" }
        };

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${createdMailUID}`, {
            method: "PUT",
            authToken: session_token,
            body: updateData,
            expectedBodySchema: MailsModel.Update.Response
        });

        expect(data.success).toBe(true);
        expect(data.newUid).toBeGreaterThan(0);

        // Update the UID for subsequent tests
        if (data.newUid) {
            createdMailUID = data.newUid;
        }

        // Verify the update
        const updatedMail = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${createdMailUID}`, {
            authToken: session_token,
            expectedBodySchema: MailsModel.GetByUID.Response
        });

        expect(updatedMail.subject).toBe("Updated Test Draft Mail");
        expect(updatedMail.body?.text).toContain("Updated body content");
    });

    test("PUT rejects attachment-backed updates above the configured limit before decoding attachments", async () => {
        const boundary = "UPDATE-LIMIT-BOUNDARY";
        const rawMessage = [
            "From: sender@test.com",
            "To: receiver@test.com",
            "Subject: Oversized existing attachment",
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain",
            "",
            "body",
            `--${boundary}`,
            "Content-Type: application/octet-stream",
            "Content-Disposition: attachment; filename=existing.bin",
            "",
            "attachment larger than ten bytes",
            `--${boundary}--`,
            ""
        ].join("\r\n");
        await testIMAPClient.createMail("INBOX", rawMessage, ["\\Draft"]);
        const newest = (await testIMAPClient.getMails("INBOX", { order: "newest", limit: 1 }))[0];
        if (!newest) throw new Error("Failed to create update-limit test mail");

        const config = ConfigHandler.getConfig();
        if (!config) throw new Error("Test config is not loaded");
        const originalLimit = config.DLA_MAX_ATTACHMENT_SIZE_MB;
        const extractionSpy = spyOn(MailParser, "getAttachmentContents");
        config.DLA_MAX_ATTACHMENT_SIZE_MB = "0.00001";

        try {
            const response = await API.getApp().request(
                `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${newest.uid}`,
                {
                    method: "PUT",
                    headers: {
                        Authorization: `Bearer ${session_token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ subject: "must not update" })
                }
            );
            expect(response.status).toBe(400);
            expect(extractionSpy).not.toHaveBeenCalled();
        } finally {
            config.DLA_MAX_ATTACHMENT_SIZE_MB = originalLimit;
            extractionSpy.mockRestore();
            await testIMAPClient.permanentlyDelete("INBOX", [newest.uid]);
        }
    });

    test("PUT /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID with invalid UID fails", async () => {

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/999999`, {
            method: "PUT",
            authToken: session_token,
            body: { subject: "Test" }
        }, 404);
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID/move moves mail to another mailbox", async () => {

        // First create a target mailbox
        await testIMAPClient.createMailbox("TestMoveTarget");

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${createdMailUID}/move`, {
            method: "POST",
            authToken: session_token,
            body: { targetMailbox: "TestMoveTarget" },
            expectedBodySchema: MailsModel.Move.Response
        });

        // Mail should now be in TestMoveTarget
        // Verify original location doesn't have it
        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${createdMailUID}`, {
            authToken: session_token
        }, 404);

        // Clean up: delete the test mailbox
        await testIMAPClient.deleteMailbox("TestMoveTarget");
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID/move with invalid UID fails", async () => {

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/999999/move`, {
            method: "POST",
            authToken: session_token,
            body: { targetMailbox: "Drafts" }
        }, 404);
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID/flags sets and clears flags", async () => {

        // Create a fresh mail to flag (createdMailUID was consumed by the move test)
        const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
            method: "POST",
            authToken: session_token,
            body: {
                from: { name: "Test Sender", address: "sender@test.com" },
                to: [{ name: "Test Receiver", address: "receiver@test.com" }],
                cc: [],
                bcc: [],
                subject: "Test Flags Mail",
                body: { text: "flags test body" }
            },
            expectedBodySchema: MailsModel.Create.Response
        });

        const flagMailUID = created.uid;

        // Set the seen and flagged flags
        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${flagMailUID}/flags`, {
            method: "POST",
            authToken: session_token,
            body: { seen: true, flagged: true },
            expectedBodySchema: MailsModel.SetFlags.Response
        });

        expect(data.success).toBe(true);
        expect(data.flags.seen).toBe(true);
        expect(data.flags.flagged).toBe(true);

        // Verify the flags were actually applied on the server
        const afterSet = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${flagMailUID}`, {
            authToken: session_token,
            expectedBodySchema: MailsModel.GetByUID.Response
        });

        expect(afterSet.rawFlags).toContain("\\Seen");
        expect(afterSet.rawFlags).toContain("\\Flagged");
        expect(afterSet.flags?.seen).toBe(true);
        expect(afterSet.flags?.flagged).toBe(true);

        // Clear the seen flag while leaving flagged untouched (omitted flags are unchanged)
        const cleared = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${flagMailUID}/flags`, {
            method: "POST",
            authToken: session_token,
            body: { seen: false },
            expectedBodySchema: MailsModel.SetFlags.Response
        });

        expect(cleared.success).toBe(true);
        expect(cleared.flags.seen).toBe(false);

        const afterClear = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${flagMailUID}`, {
            authToken: session_token,
            expectedBodySchema: MailsModel.GetByUID.Response
        });

        expect(afterClear.rawFlags).not.toContain("\\Seen");
        expect(afterClear.rawFlags).toContain("\\Flagged");
        expect(afterClear.flags?.seen).toBe(false);
        expect(afterClear.flags?.flagged).toBe(true);

        // Clean up
        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${flagMailUID}`, {
            method: "DELETE",
            authToken: session_token,
            body: { permanent: true }
        });
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID/flags with invalid UID fails", async () => {

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/999999/flags`, {
            method: "POST",
            authToken: session_token,
            body: { seen: true }
        }, 404);
    });

    test("DELETE /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID deletes mail (move to trash)", async () => {

        // Create a new mail to delete
        const mailData = {
            from: { name: "Delete Test", address: "delete@test.com" },
            to: [{ name: "Receiver", address: "receiver@test.com" }],
            cc: [],
            bcc: [],
            subject: "Mail to Delete",
            body: { text: "This mail will be deleted" }
        };

        const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
            method: "POST",
            authToken: session_token,
            body: mailData,
            expectedBodySchema: MailsModel.Create.Response
        });

        const mailToDeleteUID = created.uid;

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${mailToDeleteUID}`, {
            method: "DELETE",
            authToken: session_token,
            expectedBodySchema: MailsModel.Delete.Response
        });

        expect(data.success).toBe(true);

        // Verify the mail is no longer in INBOX
        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${mailToDeleteUID}`, {
            authToken: session_token
        }, 404);

        // Verify it actually landed in Trash (specialUse-based resolution), not just vanished
        const trashMails = await testIMAPClient.getMails("Trash", { searchString: "Mail to Delete" });
        expect(trashMails.length).toBeGreaterThan(0);
    });

    test("DELETE /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID with permanent=true deletes permanently", async () => {

        // Create a new mail to delete permanently
        const mailData = {
            from: { name: "Permanent Delete Test", address: "permdelete@test.com" },
            to: [{ name: "Receiver", address: "receiver@test.com" }],
            cc: [],
            bcc: [],
            subject: "Mail to Permanently Delete",
            body: { text: "This mail will be permanently deleted" }
        };

        const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
            method: "POST",
            authToken: session_token,
            body: mailData,
            expectedBodySchema: MailsModel.Create.Response
        });

        const mailToDeleteUID = created.uid;

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${mailToDeleteUID}?permanent=true`, {
            method: "DELETE",
            authToken: session_token,
            expectedBodySchema: MailsModel.Delete.Response
        });

        expect(data.success).toBe(true);

        // Verify the mail was actually expunged, not merely flagged \Deleted in place
        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${mailToDeleteUID}`, {
            authToken: session_token
        }, 404);

        // And that it wasn't just silently moved to Trash instead
        const trashMails = await testIMAPClient.getMails("Trash", { searchString: "Mail to Permanently Delete" });
        expect(trashMails.length).toBe(0);
    });

    test("DELETE /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID with invalid UID fails", async () => {

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/999999`, {
            method: "DELETE",
            authToken: session_token
        }, 404);
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mail-bulk-actions/move moves multiple mails to another mailbox", async () => {

        await testIMAPClient.createMailbox("TestBulkMoveTarget");

        const uids: number[] = [];
        for (const subject of ["Bulk Move 1", "Bulk Move 2"]) {
            const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
                method: "POST",
                authToken: session_token,
                body: {
                    from: { name: "Bulk Test", address: "bulk@test.com" },
                    to: [{ name: "Receiver", address: "receiver@test.com" }],
                    cc: [],
                    bcc: [],
                    subject,
                    body: { text: "bulk move test" }
                },
                expectedBodySchema: MailsModel.Create.Response
            });
            uids.push(created.uid);
        }

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mail-bulk-actions/move`, {
            method: "POST",
            authToken: session_token,
            body: { uids, targetMailbox: "TestBulkMoveTarget" },
            expectedBodySchema: MailBulkActionsModel.BulkMove.Response
        });

        expect(data.success).toBe(true);

        for (const uid of uids) {
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, {
                authToken: session_token
            }, 404);
        }

        const targetMails = await testIMAPClient.getMails("TestBulkMoveTarget");
        expect(targetMails.length).toBe(uids.length);

        await testIMAPClient.deleteMailbox("TestBulkMoveTarget");
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mail-bulk-actions/copy copies multiple mails without removing originals", async () => {

        await testIMAPClient.createMailbox("TestBulkCopyTarget");

        const uids: number[] = [];
        for (const subject of ["Bulk Copy 1", "Bulk Copy 2"]) {
            const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
                method: "POST",
                authToken: session_token,
                body: {
                    from: { name: "Bulk Test", address: "bulk@test.com" },
                    to: [{ name: "Receiver", address: "receiver@test.com" }],
                    cc: [],
                    bcc: [],
                    subject,
                    body: { text: "bulk copy test" }
                },
                expectedBodySchema: MailsModel.Create.Response
            });
            uids.push(created.uid);
        }

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mail-bulk-actions/copy`, {
            method: "POST",
            authToken: session_token,
            body: { uids, targetMailbox: "TestBulkCopyTarget" },
            expectedBodySchema: MailBulkActionsModel.BulkCopy.Response
        });

        expect(data.success).toBe(true);

        // Originals should still be present in INBOX
        for (const uid of uids) {
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, {
                authToken: session_token
            });
        }

        const targetMails = await testIMAPClient.getMails("TestBulkCopyTarget");
        expect(targetMails.length).toBe(uids.length);

        await testIMAPClient.deleteMailbox("TestBulkCopyTarget");
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mail-bulk-actions/delete moves multiple mails to trash", async () => {

        const uids: number[] = [];
        for (const subject of ["Bulk Delete 1", "Bulk Delete 2"]) {
            const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
                method: "POST",
                authToken: session_token,
                body: {
                    from: { name: "Bulk Test", address: "bulk@test.com" },
                    to: [{ name: "Receiver", address: "receiver@test.com" }],
                    cc: [],
                    bcc: [],
                    subject,
                    body: { text: "bulk delete test" }
                },
                expectedBodySchema: MailsModel.Create.Response
            });
            uids.push(created.uid);
        }

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mail-bulk-actions/delete`, {
            method: "POST",
            authToken: session_token,
            body: { uids },
            expectedBodySchema: MailBulkActionsModel.BulkDelete.Response
        });

        expect(data.success).toBe(true);

        for (const uid of uids) {
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, {
                authToken: session_token
            }, 404);
        }

        const trashMails = await testIMAPClient.getMails("Trash", { searchString: "Bulk Delete" });
        expect(trashMails.length).toBeGreaterThanOrEqual(uids.length);
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mail-bulk-actions/delete with permanent=true removes multiple mails", async () => {

        const uids: number[] = [];
        for (const subject of ["Bulk Perm Delete 1", "Bulk Perm Delete 2"]) {
            const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
                method: "POST",
                authToken: session_token,
                body: {
                    from: { name: "Bulk Test", address: "bulk@test.com" },
                    to: [{ name: "Receiver", address: "receiver@test.com" }],
                    cc: [],
                    bcc: [],
                    subject,
                    body: { text: "bulk perm delete test" }
                },
                expectedBodySchema: MailsModel.Create.Response
            });
            uids.push(created.uid);
        }

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mail-bulk-actions/delete`, {
            method: "POST",
            authToken: session_token,
            body: { uids, permanent: true },
            expectedBodySchema: MailBulkActionsModel.BulkDelete.Response
        });

        expect(data.success).toBe(true);

        for (const uid of uids) {
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, {
                authToken: session_token
            }, 404);
        }

        const trashMails = await testIMAPClient.getMails("Trash", { searchString: "Bulk Perm Delete" });
        expect(trashMails.length).toBe(0);
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/bulk-move with empty uids fails validation", async () => {

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/bulk-move`, {
            method: "POST",
            authToken: session_token,
            body: { uids: [], targetMailbox: "Drafts" }
        }, 400);
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mail-bulk-actions/flags sets and clears flags on multiple mails", async () => {

        const uids: number[] = [];
        for (const subject of ["Bulk Flag Read 1", "Bulk Flag Read 2"]) {
            const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
                method: "POST",
                authToken: session_token,
                body: {
                    from: { name: "Bulk Test", address: "bulk@test.com" },
                    to: [{ name: "Receiver", address: "receiver@test.com" }],
                    cc: [],
                    bcc: [],
                    subject,
                    body: { text: "bulk flag test" }
                },
                expectedBodySchema: MailsModel.Create.Response
            });
            uids.push(created.uid);
        }

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mail-bulk-actions/flags`, {
            method: "POST",
            authToken: session_token,
            body: { uids, flags: { seen: true } },
            expectedBodySchema: MailBulkActionsModel.BulkSetFlags.Response
        });

        expect(data.success).toBe(true);

        for (const uid of uids) {
            const mail = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, {
                authToken: session_token,
                expectedBodySchema: MailsModel.GetByUID.Response
            });
            expect(mail.flags?.seen).toBe(true);
        }

        // Now clear the seen flag on the same UIDs
        const cleared = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mail-bulk-actions/flags`, {
            method: "POST",
            authToken: session_token,
            body: { uids, flags: { seen: false } },
            expectedBodySchema: MailBulkActionsModel.BulkSetFlags.Response
        });

        expect(cleared.success).toBe(true);

        for (const uid of uids) {
            const mail = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, {
                authToken: session_token,
                expectedBodySchema: MailsModel.GetByUID.Response
            });
            expect(mail.flags?.seen).toBe(false);
        }
    });

    test("POST send relays multipart attachments and keeps Bcc out of the raw message", async () => {
        const smtp = SMTPAccount.fromConfig({
            host: "smtp.example.com",
            port: 587,
            username: "testuser",
            password: "testpass",
            useSSL: connectionSettings.smtp_encryption
        });
        let sentOptions: any;
        (smtp as any).client.sendMail = async (options: any) => {
            sentOptions = options;
            return { messageId: "route-message-id" };
        };
        const fromSettingsSpy = spyOn(SMTPAccount, "fromSettings").mockReturnValue(smtp);

        const form = new FormData();
        form.set("mail", JSON.stringify({
            from: { address: "sender@example.com" },
            to: [{ address: "receiver@example.com" }],
            cc: [],
            bcc: [{ address: "hidden@example.com" }],
            subject: "Multipart route send",
            body: { text: "route body" },
            flags: { draft: true }
        }));
        form.append("attachments", new File(["route attachment body"], "route-note.txt", {
            type: "text/plain"
        }));

        const createResponse = await API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`,
            { method: "POST", headers: { Authorization: `Bearer ${session_token}` }, body: form }
        );
        expect(createResponse.status).toBe(200);
        const created = await createResponse.json() as { data: { uid: number } };
        const mailToSendUID = created.data.uid;

        try {
            const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${mailToSendUID}/send`, {
                method: "POST",
                authToken: session_token,
                body: { moveToSent: false, deleteOriginal: false },
                expectedBodySchema: MailsModel.Send.Response
            });

            expect(sentOptions.envelope).toEqual({
                from: "sender@example.com",
                to: ["receiver@example.com", "hidden@example.com"]
            });
            const rawText = Buffer.isBuffer(sentOptions.raw)
                ? sentOptions.raw.toString("utf8")
                : String(sentOptions.raw);
            expect(rawText).not.toMatch(/^Bcc\s*:/mi);

            // The response carries the Message-ID that was delivered, not the one
            // nodemailer generates for raw input.
            expect(data.messageId).not.toBe("route-message-id");
            expect(rawText).toContain(`Message-ID: ${data.messageId}`);

            const attachment = await MailParser.getAttachmentContent(sentOptions.raw, 0);
            expect(attachment?.filename).toBe("route-note.txt");
            expect(new TextDecoder().decode(attachment?.content)).toBe("route attachment body");
        } finally {
            fromSettingsSpy.mockRestore();
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${mailToSendUID}?permanent=true`, {
                method: "DELETE",
                authToken: session_token
            });
        }
    });

    /** Route SMTP sends to a transport that records them, or fails with `sendError`. */
    function mockSMTPTransport(sendError?: unknown) {
        const smtp = SMTPAccount.fromConfig({
            host: "smtp.example.com",
            port: 587,
            username: "testuser",
            password: "testpass",
            useSSL: connectionSettings.smtp_encryption
        });
        const sent: any[] = [];
        (smtp as any).client.sendMail = async (options: any) => {
            if (sendError) throw sendError;
            sent.push(options);
            return { messageId: "generated-by-transport" };
        };
        const fromSettingsSpy = spyOn(SMTPAccount, "fromSettings").mockReturnValue(smtp);
        return { sent, restore: () => fromSettingsSpy.mockRestore() };
    }

    async function createInboxDraft(subject: string, recipients: { address: string }[] = [{ address: "receiver@example.com" }]) {
        const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
            method: "POST",
            authToken: session_token,
            body: {
                from: { address: "sender@example.com" },
                to: recipients,
                cc: [],
                bcc: [],
                subject,
                body: { text: `${subject} body` },
                flags: { draft: true }
            },
            expectedBodySchema: MailsModel.Create.Response
        });
        return created.uid;
    }

    function sendDraft(uid: number, body: Record<string, boolean>) {
        return API.getApp().request(
            `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}/send`,
            {
                method: "POST",
                headers: { Authorization: `Bearer ${session_token}`, "Content-Type": "application/json" },
                body: JSON.stringify(body)
            }
        );
    }

    async function takeFromMailbox(mailboxPath: string, subject: string) {
        const mails = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/${mailboxPath}/mails`, {
            authToken: session_token,
            expectedBodySchema: MailsModel.GetAll.Response
        });
        const mail = mails.find(m => m.subject === subject);
        if (mail) {
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/${mailboxPath}/mails/${mail.uid}?permanent=true`, {
                method: "DELETE",
                authToken: session_token
            });
        }
        return mail;
    }

    test("POST send with moveToSent files the draft in Sent and returns its Message-ID", async () => {
        const smtp = mockSMTPTransport();
        const uid = await createInboxDraft("Moved to Sent after sending");

        try {
            const draft = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, {
                authToken: session_token,
                expectedBodySchema: MailsModel.GetByUID.Response
            });

            const response = await sendDraft(uid, { moveToSent: true });
            expect(response.status).toBe(200);
            const { data } = await response.json() as { data: MailsModel.Send.Response };

            expect(smtp.sent).toHaveLength(1);
            expect(data.messageId).toBeDefined();
            expect(data.messageId).toBe(draft.messageId);
            expect(data.savedToSent).toBe(true);
            expect((smtp.sent[0].raw as Buffer).toString()).toContain(`Message-ID: ${data.messageId}`);

            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, { authToken: session_token }, 404);
            const moved = await takeFromMailbox("Sent", "Moved to Sent after sending");
            expect(moved?.messageId).toBe(data.messageId);
            // The sent copy is a read message, no longer a draft.
            expect(moved?.flags?.draft).toBe(false);
            expect(moved?.flags?.seen).toBe(true);
        } finally {
            smtp.restore();
        }
    });

    test("POST send still succeeds when filing the sent mail fails", async () => {
        const smtp = mockSMTPTransport();
        const moveSpy = spyOn(IMAPAccount.prototype, "moveToMailbox").mockRejectedValueOnce(new Error("MOVE failed"));
        const uid = await createInboxDraft("Filing fails after sending");

        try {
            const response = await sendDraft(uid, { moveToSent: true });
            expect(response.status).toBe(200);
            const { data } = await response.json() as { data: MailsModel.Send.Response };
            expect(data.savedToSent).toBe(false);
            expect(smtp.sent).toHaveLength(1);
        } finally {
            moveSpy.mockRestore();
            smtp.restore();
            await takeFromMailbox("INBOX", "Filing fails after sending");
        }
    });

    test("POST send keeps the mail in place, no longer a draft, when there is no Sent folder", async () => {
        const smtp = mockSMTPTransport();
        const sentPathSpy = spyOn(SpecialUseHandler, "resolveSentPath").mockResolvedValueOnce(null);
        const uid = await createInboxDraft("Sent without a Sent folder");

        try {
            const response = await sendDraft(uid, { moveToSent: true });
            expect(response.status).toBe(200);
            const { data } = await response.json() as { data: MailsModel.Send.Response };
            expect(data.savedToSent).toBe(false);

            const stored = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, {
                authToken: session_token,
                expectedBodySchema: MailsModel.GetByUID.Response
            });
            expect(stored.flags?.draft).toBe(false);
            expect(stored.flags?.seen).toBe(true);
        } finally {
            sentPathSpy.mockRestore();
            smtp.restore();
            await takeFromMailbox("INBOX", "Sent without a Sent folder");
        }
    });

    test("POST send with deleteOriginal moves the draft to Trash", async () => {
        const smtp = mockSMTPTransport();
        const uid = await createInboxDraft("Trashed after sending");

        try {
            const response = await sendDraft(uid, { moveToSent: false, deleteOriginal: true });
            expect(response.status).toBe(200);
            expect(smtp.sent).toHaveLength(1);

            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, { authToken: session_token }, 404);
            expect(await takeFromMailbox("Trash", "Trashed after sending")).toBeDefined();
        } finally {
            smtp.restore();
        }
    });

    test("POST send rejects a draft without recipients and leaves it in place", async () => {
        const smtp = mockSMTPTransport();
        const uid = await createInboxDraft("Draft without recipients", []);

        try {
            const response = await sendDraft(uid, { moveToSent: true });
            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toMatchObject({ message: "Mail must include a sender and at least one recipient" });

            expect(smtp.sent).toHaveLength(0);
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, { authToken: session_token });
        } finally {
            smtp.restore();
            await takeFromMailbox("INBOX", "Draft without recipients");
        }
    });

    test("POST send reports a mail server size rejection as a client error and leaves the draft in place", async () => {
        const sizeRejection = Object.assign(new Error("Message failed: 552 5.3.4 Message size exceeds fixed limit"), {
            code: "EMESSAGE",
            responseCode: 552,
            response: "552 5.3.4 Message size exceeds fixed limit"
        });
        const smtp = mockSMTPTransport(sizeRejection);
        const uid = await createInboxDraft("Too large for the mail server");

        try {
            const response = await sendDraft(uid, { moveToSent: true });
            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toMatchObject({
                message: "The mail server rejected the message because it is too large"
            });

            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, { authToken: session_token });
        } finally {
            smtp.restore();
            await takeFromMailbox("INBOX", "Too large for the mail server");
        }
    });

    test("POST send reports other SMTP failures as a server error and leaves the draft in place", async () => {
        const smtp = mockSMTPTransport(Object.assign(new Error("Connection closed unexpectedly"), { code: "ECONNECTION" }));
        const uid = await createInboxDraft("SMTP connection failure");

        try {
            const response = await sendDraft(uid, { moveToSent: true });
            expect(response.status).toBe(500);
            await expect(response.json()).resolves.toMatchObject({ message: "Failed to send mail" });

            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}`, { authToken: session_token });
        } finally {
            smtp.restore();
            await takeFromMailbox("INBOX", "SMTP connection failure");
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID/send with invalid UID fails", async () => {

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/999999/send`, {
            method: "POST",
            authToken: session_token,
            body: { moveToSent: true }
        }, 404);
    });

    test("GET /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails retrieves mails in mailbox", async () => {

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
            authToken: session_token,
            expectedBodySchema: MailsModel.GetAll.Response
        });

        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThanOrEqual(0);

        // Find the preseeded test mail by subject instead of fixed index
        const mail = data.find(m => m.subject === "hello 4");
        expect(mail).toBeDefined();
        if (!mail) return;

        expect(mail.subject).toBe("hello 4");

        expect(mail.from).toBeDefined();
        if (!mail.from) return;
        expect(mail.from).toEqual({ name: "sender name", address: "sender@example.com" });
        
        expect(mail.to[0]).toBeDefined();
        if (!mail.to[0]) return;
        expect(mail.to[0]).toEqual({ name: "Receiver name", address: "receiver@example.com" });

        expect(mail.date).toBe(new Date("Fri, 13 Sep 2013 15:01:00 +0300").getTime());

        expect(mail.rawFlags).toContain("\\Seen");
        expect(mail.rawFlags).toContain("\\Answered");
        expect(mail.rawFlags).toContain("\\Flagged");

        expect(mail.flags).toBeDefined();
        if (!mail.flags) return;
        expect(mail.flags.seen).toBe(true);
        expect(mail.flags.answered).toBe(true);
        expect(mail.flags.flagged).toBe(true);
        expect(mail.flags.deleted).toBe(false);
        expect(mail.flags.draft).toBe(false);
        expect(mail.flags.recent).toBe(false);

        expect(mail.body?.text).toBeDefined();
        if (!mail.body?.text) return;
        expect(mail.body.text.trim()).toBe("World 4!");
    });

});

describe("Mail Search Routes", async () => {

    let searchTestUser: SeededUser;
    let session_token: string;
    let mailAccountID: number;
    let testIMAPClient: IMAPAccount;

    const connectionSettings = {
        smtp_host: "127.0.0.1",
        smtp_port: 11125,
        smtp_encryption: "NONE",
        smtp_username: "testuser",
        smtp_password: "testpass",

        imap_host: "127.0.0.1",
        imap_port: 11143,
        imap_encryption: "NONE",
        imap_username: "testuser",
        imap_password: "testpass"
    } as const;

    beforeAll(async () => {

        searchTestUser = await seedUser("user", { username: "searchtestuser" }, "SearchTestP@ss1");
        session_token = await seedSession(searchTestUser.id).then(s => s.token);

        testIMAPClient = await IMAPAccount.fromConfig({
            host: connectionSettings.imap_host,
            port: connectionSettings.imap_port,
            username: connectionSettings.imap_username,
            password: connectionSettings.imap_password,
            useSSL: connectionSettings.imap_encryption
        }).connect();

        const encryptedSMTPData = MailAccountEncryption.encryptSMTPData({
            host: connectionSettings.smtp_host,
            port: connectionSettings.smtp_port,
            username: connectionSettings.smtp_username,
            password: connectionSettings.smtp_password,
            useSSL: connectionSettings.smtp_encryption
        });

        const encryptedIMAPData = MailAccountEncryption.encryptIMAPData({
            host: connectionSettings.imap_host,
            port: connectionSettings.imap_port,
            username: connectionSettings.imap_username,
            password: connectionSettings.imap_password,
            useSSL: connectionSettings.imap_encryption
        });

        if (!encryptedSMTPData || !encryptedIMAPData) {
            throw new Error("Failed to encrypt mail account data");
        }

        mailAccountID = DB.instance().insert(DB.Tables.mailAccounts).values({
            owner_user_id: searchTestUser.id,
            display_name: "Test Mail Account",
            smtp_encrypted_connection_data: encryptedSMTPData,
            imap_encrypted_connection_data: encryptedIMAPData
        }).returning().get().id;
    });

    afterAll(async () => {
        await testIMAPClient.disconnect();

        SessionHandler.inValidateAllSessionsForUser(searchTestUser.id);

        DB.instance().delete(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.id, mailAccountID)
        ).run();

        DB.instance().delete(DB.Tables.users).where(
            eq(DB.Tables.users.id, searchTestUser.id)
        ).run();
    });

    test("GET /v1/mail-accounts/:mailAccountID/search performs quick search", async () => {

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search?q=hello`, {
            authToken: session_token,
            expectedBodySchema: SearchModel.QuickSearch.Response
        });

        expect(data.mailboxesSearched).toBeGreaterThan(0);
        expect(Array.isArray(data.results)).toBe(true);
        expect(data.total).toBeGreaterThanOrEqual(0);

        // Check that results have proper structure
        if (data.results.length > 0) {
            const result = data.results[0];
            expect(result).toBeDefined();
            if (!result) return;

            expect(result.mailboxPath).toBeDefined();
            expect(result.mailboxName).toBeDefined();
            expect(result.mail).toBeDefined();
            expect(result.mail.uid).toBeGreaterThan(0);
        }
    });

    test("GET /v1/mail-accounts/:mailAccountID/search with empty query fails", async () => {

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search?q=`, {
            authToken: session_token
        }, 400);
    });

    test("GET /v1/mail-accounts/:mailAccountID/search with limit and offset", async () => {

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search?q=hello&limit=5&offset=0&order=newest`, {
            authToken: session_token,
            expectedBodySchema: SearchModel.QuickSearch.Response
        });

        expect(data.results.length).toBeLessThanOrEqual(5);
    });

    test("POST /v1/mail-accounts/:mailAccountID/search performs advanced search by subject", async () => {

        const searchBody = {
            subject: "hello"
        };

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search`, {
            method: "POST",
            authToken: session_token,
            body: searchBody,
            expectedBodySchema: SearchModel.CrossFolderSearch.Response
        });

        expect(data.mailboxesSearched).toBeGreaterThan(0);
        expect(Array.isArray(data.results)).toBe(true);
        expect(data.total).toBeGreaterThanOrEqual(0);

        // All results should contain "hello" in subject
        for (const result of data.results) {
            expect(result.mail.subject?.toLowerCase()).toContain("hello");
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/search performs advanced search by from", async () => {

        const searchBody = {
            from: "sender@example.com"
        };

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search`, {
            method: "POST",
            authToken: session_token,
            body: searchBody,
            expectedBodySchema: SearchModel.CrossFolderSearch.Response
        });

        expect(Array.isArray(data.results)).toBe(true);

        // All results should be from the specified sender
        for (const result of data.results) {
            expect(result.mail.from?.address).toBe("sender@example.com");
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/search with flag filters", async () => {

        const searchBody = {
            seen: true
        };

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search`, {
            method: "POST",
            authToken: session_token,
            body: searchBody,
            expectedBodySchema: SearchModel.CrossFolderSearch.Response
        });

        expect(Array.isArray(data.results)).toBe(true);

        // All results should be marked as seen
        for (const result of data.results) {
            expect(result.mail.flags?.seen).toBe(true);
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/search with mailbox filter", async () => {

        const searchBody = {
            text: "hello"
        };

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search?mailboxes=INBOX`, {
            method: "POST",
            authToken: session_token,
            body: searchBody,
            expectedBodySchema: SearchModel.CrossFolderSearch.Response
        });

        expect(Array.isArray(data.results)).toBe(true);

        // All results should be from INBOX
        for (const result of data.results) {
            expect(result.mailboxPath).toBe("INBOX");
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/search without criteria fails", async () => {

        const searchBody = {};

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search`, {
            method: "POST",
            authToken: session_token,
            body: searchBody
        }, 400);
    });

    test("POST /v1/mail-accounts/:mailAccountID/search/count returns count and breakdown", async () => {

        const searchBody = {
            text: "hello"
        };

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search/count`, {
            method: "POST",
            authToken: session_token,
            body: searchBody,
            expectedBodySchema: SearchModel.Count.Response
        });

        expect(data).toBeDefined();
        if (!data) return;

        expect(data.total).toBeGreaterThanOrEqual(0);
        expect(data.mailboxesSearched).toBeGreaterThan(0);
        expect(Array.isArray(data.breakdown)).toBe(true);

        // Check breakdown structure
        for (const item of data.breakdown) {
            expect(item.mailboxPath).toBeDefined();
            expect(item.mailboxName).toBeDefined();
            expect(item.count).toBeGreaterThanOrEqual(0);
        }
    });

    test("POST /v1/mail-accounts/:mailAccountID/search/count without criteria fails", async () => {

        const searchBody = {};

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search/count`, {
            method: "POST",
            authToken: session_token,
            body: searchBody
        }, 400);
    });

    test("GET /v1/mail-accounts/:mailAccountID/search with invalid mail account fails", async () => {

        await makeAPIRequest(`/v1/mail-accounts/999999/search?q=hello`, {
            authToken: session_token
        }, 404);
    });

    test("POST /v1/mail-accounts/:mailAccountID/search combined criteria search", async () => {

        const searchBody = {
            subject: "hello",
            from: "sender",
            seen: true,
            flagged: true
        };

        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/search`, {
            method: "POST",
            authToken: session_token,
            body: searchBody,
            expectedBodySchema: SearchModel.CrossFolderSearch.Response
        });

        expect(Array.isArray(data.results)).toBe(true);

        // Results should match all criteria
        for (const result of data.results) {
            expect(result.mail.subject?.toLowerCase()).toContain("hello");
            expect(result.mail.flags?.seen).toBe(true);
            expect(result.mail.flags?.flagged).toBe(true);
        }
    });

});

describe("Mail Attachment Routes", async () => {

    let attachmentTestUser: SeededUser;
    let session_token: string;
    let mailAccountID: number;
    let testIMAPClient: IMAPAccount;

    // UID of the appended message that carries an attachment.
    let attachmentMailUID: number;
    // UID of a preseeded plain-text message with no attachments.
    let plainMailUID: number;

    const ATTACHMENT_FILENAME = "hello.txt";
    const ATTACHMENT_CONTENT = "Attachment content here";
    const UNIQUE_SUBJECT = `Mail With Attachment ${randomUUID().slice(0, 8)}`;

    const connectionSettings = {
        smtp_host: "127.0.0.1",
        smtp_port: 11125,
        smtp_encryption: "NONE",
        smtp_username: "testuser",
        smtp_password: "testpass",

        imap_host: "127.0.0.1",
        imap_port: 11143,
        imap_encryption: "NONE",
        imap_username: "testuser",
        imap_password: "testpass"
    } as const;

    /** Build the attachments base path for a given mail UID. */
    function attachmentsPath(uid: number) {
        return `/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${uid}/attachments`;
    }

    beforeAll(async () => {

        attachmentTestUser = await seedUser("user", { username: "attachmenttestuser" }, "AttachTestP@ss1");
        session_token = await seedSession(attachmentTestUser.id).then(s => s.token);

        testIMAPClient = await IMAPAccount.fromConfig({
            host: connectionSettings.imap_host,
            port: connectionSettings.imap_port,
            username: connectionSettings.imap_username,
            password: connectionSettings.imap_password,
            useSSL: connectionSettings.imap_encryption
        }).connect();

        const encryptedSMTPData = MailAccountEncryption.encryptSMTPData({
            host: connectionSettings.smtp_host,
            port: connectionSettings.smtp_port,
            username: connectionSettings.smtp_username,
            password: connectionSettings.smtp_password,
            useSSL: connectionSettings.smtp_encryption
        });

        const encryptedIMAPData = MailAccountEncryption.encryptIMAPData({
            host: connectionSettings.imap_host,
            port: connectionSettings.imap_port,
            username: connectionSettings.imap_username,
            password: connectionSettings.imap_password,
            useSSL: connectionSettings.imap_encryption
        });

        if (!encryptedSMTPData || !encryptedIMAPData) {
            throw new Error("Failed to encrypt mail account data");
        }

        mailAccountID = DB.instance().insert(DB.Tables.mailAccounts).values({
            owner_user_id: attachmentTestUser.id,
            display_name: "Test Mail Account",
            smtp_encrypted_connection_data: encryptedSMTPData,
            imap_encrypted_connection_data: encryptedIMAPData
        }).returning().get().id;

        // Append a MIME message with a single text attachment.
        const rawMessage = [
            "From: sender@test.com",
            "To: receiver@test.com",
            `Subject: ${UNIQUE_SUBJECT}`,
            "MIME-Version: 1.0",
            'Content-Type: multipart/mixed; boundary="XBOUNDARYX"',
            "",
            "--XBOUNDARYX",
            "Content-Type: text/plain; charset=utf-8",
            "",
            "This is the email body.",
            "--XBOUNDARYX",
            `Content-Type: text/plain; name="${ATTACHMENT_FILENAME}"`,
            `Content-Disposition: attachment; filename="${ATTACHMENT_FILENAME}"`,
            "",
            ATTACHMENT_CONTENT,
            "--XBOUNDARYX--",
            ""
        ].join("\r\n");

        await testIMAPClient.createMail("INBOX", rawMessage, []);

        // Resolve the UIDs of both the appended attachment mail and a plain mail.
        const mails = await testIMAPClient.getMails("INBOX", { order: "newest", limit: 100 });

        const appended = mails.find(m => m.subject === UNIQUE_SUBJECT);
        if (!appended) throw new Error("Failed to locate appended attachment mail");
        attachmentMailUID = appended.uid;

        const plain = mails.find(m => m.subject === "hello 1");
        if (!plain) throw new Error("Failed to locate preseeded plain mail");
        plainMailUID = plain.uid;
    });

    afterAll(async () => {
        await testIMAPClient.disconnect();
    });

    test("GET .../attachments lists attachment metadata", async () => {

        const data = await makeAPIRequest(attachmentsPath(attachmentMailUID), {
            authToken: session_token,
            expectedBodySchema: AttachmentsModel.GetAll.Response
        });

        expect(data.length).toBe(1);

        const att = data[0];
        expect(att).toBeDefined();
        if (!att) return;

        expect(att.id).toBe(0);
        expect(att.filename).toBe(ATTACHMENT_FILENAME);
        expect(att.contentType).toContain("text/plain");
        expect(att.size).toBeGreaterThan(0);
    });

    test("GET .../attachments for a mail without attachments returns an empty list", async () => {

        const data = await makeAPIRequest(attachmentsPath(plainMailUID), {
            authToken: session_token,
            expectedBodySchema: AttachmentsModel.GetAll.Response
        });

        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(0);
    });

    test("GET .../attachments/:id streams the content inline with the right headers", async () => {

        const res = await API.getApp().request(`${attachmentsPath(attachmentMailUID)}/0`, {
            headers: { Authorization: `Bearer ${session_token}` }
        });

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type") || "").toContain("text/plain");

        const disposition = res.headers.get("content-disposition") || "";
        expect(disposition).toContain("inline");
        expect(disposition).toContain(`filename="${ATTACHMENT_FILENAME}"`);

        // Must never be cached on any hop.
        expect(res.headers.get("cache-control") || "").toContain("no-store");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");

        const bytes = new Uint8Array(await res.arrayBuffer());
        expect(new TextDecoder().decode(bytes)).toContain(ATTACHMENT_CONTENT);

        // The advertised size must match the actual number of bytes streamed.
        const list = await makeAPIRequest(attachmentsPath(attachmentMailUID), {
            authToken: session_token,
            expectedBodySchema: AttachmentsModel.GetAll.Response
        });
        expect(list[0]?.size).toBe(bytes.byteLength);
    });

    test("GET .../attachments/:id?download=true forces an attachment disposition", async () => {

        const res = await API.getApp().request(`${attachmentsPath(attachmentMailUID)}/0?download=true`, {
            headers: { Authorization: `Bearer ${session_token}` }
        });

        expect(res.status).toBe(200);
        expect(res.headers.get("content-disposition") || "").toContain("attachment");
    });

    test("GET .../attachments/:id with an out-of-range id returns 404", async () => {

        await makeAPIRequest(`${attachmentsPath(attachmentMailUID)}/5`, {
            authToken: session_token
        }, 404);
    });

    test("GET .../attachments/:id on a mail without attachments returns 404", async () => {

        await makeAPIRequest(`${attachmentsPath(plainMailUID)}/0`, {
            authToken: session_token
        }, 404);
    });

    test("GET .../attachments for a non-existent mail UID returns 404", async () => {

        await makeAPIRequest(attachmentsPath(999999), {
            authToken: session_token
        }, 404);

        await makeAPIRequest(`${attachmentsPath(999999)}/0`, {
            authToken: session_token
        }, 404);
    });

    test("Attachment routes require authentication", async () => {

        await makeAPIRequest(attachmentsPath(attachmentMailUID), {}, 401);
        await makeAPIRequest(`${attachmentsPath(attachmentMailUID)}/0`, {}, 401);
    });

});

describe("Docs Routes", async () => {

    test("GET /docs/v1/openapi returns API docs if enabled", async () => {
        await makeAPIRequest(`/docs/v1/openapi`, {}, 200);
    });

    test("GET /docs/v1/openapi documents the create and update mail request bodies", async () => {
        const specText = await (await API.getApp().request(`/docs/v1/openapi`)).text();
        // An unresolved schema promise serializes as {"__quansync":true}.
        expect(specText).not.toContain("__quansync");

        const spec = JSON.parse(specText);
        const create = spec.paths["/mail-accounts/{mailAccountID}/mailboxes/{mailboxPath}/mails"].post.requestBody.content;
        expect(create["application/json"].schema).toMatchObject({
            type: "object",
            required: expect.arrayContaining(["to", "cc", "bcc", "body"])
        });
        expect(create["application/json"].schema.properties).toHaveProperty("subject");
        expect(create["multipart/form-data"].schema).toMatchObject({ required: ["mail"] });

        const update = spec.paths["/mail-accounts/{mailAccountID}/mailboxes/{mailboxPath}/mails/{mailUID}"].put.requestBody.content;
        expect(update["application/json"].schema.properties).toHaveProperty("removeAttachments");
        expect(update["multipart/form-data"].schema).toMatchObject({ required: ["mail"] });
    });

    test("GET /docs/v1 returns API docs UI if enabled", async () => {
        await makeAPIRequest(`/docs/v1`, {}, 200);
    });

    test("GET /docs/openapi returns 404 if disabled", async () => {

        await API.stop();
        await API.init([], true);

        await makeAPIRequest(`/docs/v1/openapi`, {}, 404);
    });

    test("GET /docs/v1 returns 404 if disabled", async () => {

        await makeAPIRequest(`/docs/v1`, {}, 404);
    });
});
// Fabricate a mailbox for the pure-function unit tests below.
function fakeMailbox(path: string, specialUse?: string, delimiter = "/"): MailboxRessource {
    return new MailboxRessource({
        name: path.split(delimiter).pop() || path,
        path,
        delimiter,
        parent: [],
        parentPath: "",
        flags: [],
        specialUse,
        status: { messages: 0, unseen: 0, recent: 0 },
    });
}

describe("SpecialUse detection (unit)", async () => {

    test("detectType prefers the server SPECIAL-USE flag", () => {
        const boxes = [fakeMailbox("Sent", "\\Sent"), fakeMailbox("Something Else")];
        expect(SpecialUse.detectType("sent", boxes)).toEqual({ path: "Sent", source: "flag" });
    });

    test("detectType falls back to (localized) leaf-name heuristics", () => {
        // German "Gesendet" with no flag should still resolve as Sent.
        const boxes = [fakeMailbox("INBOX.Gesendet", undefined, ".")];
        expect(SpecialUse.detectType("sent", boxes)).toEqual({ path: "INBOX.Gesendet", source: "guess" });
    });

    test("detectType returns undefined when nothing matches", () => {
        const boxes = [fakeMailbox("Random"), fakeMailbox("Another")];
        expect(SpecialUse.detectType("archive", boxes)).toBeUndefined();
    });

    test("reconcile from scratch resolves the whole mapping and omits missing types", () => {
        const boxes = [
            fakeMailbox("INBOX"),
            fakeMailbox("Sent", "\\Sent"),
            fakeMailbox("Drafts", "\\Drafts"),
            fakeMailbox("Trash"),   // by name only
        ];
        const mapping = SpecialUse.reconcile(null, boxes);
        expect(mapping.inbox?.path).toBe("INBOX");
        expect(mapping.sent).toEqual({ path: "Sent", source: "flag" });
        expect(mapping.drafts).toEqual({ path: "Drafts", source: "flag" });
        expect(mapping.trash).toEqual({ path: "Trash", source: "guess" });
        expect(mapping.spam).toBeUndefined();
        expect(mapping.archive).toBeUndefined();
    });

    test("reconcile keeps a still-valid user override but re-detects the rest", () => {
        const boxes = [fakeMailbox("Custom"), fakeMailbox("Sent", "\\Sent"), fakeMailbox("Trash", "\\Trash")];
        const existing: SpecialUse.Mapping = {
            drafts: { path: "Custom", source: "user" },
            sent: { path: "Old", source: "flag" },
        };
        const result = SpecialUse.reconcile(existing, boxes);
        expect(result.drafts).toEqual({ path: "Custom", source: "user" });   // preserved
        expect(result.sent).toEqual({ path: "Sent", source: "flag" });        // re-detected
        expect(result.trash).toEqual({ path: "Trash", source: "flag" });      // newly detected
    });

    test("reconcile drops a user override whose folder no longer exists", () => {
        const boxes = [fakeMailbox("Sent", "\\Sent")];
        const existing: SpecialUse.Mapping = { drafts: { path: "GoneFolder", source: "user" } };
        const result = SpecialUse.reconcile(existing, boxes);
        expect(result.drafts).toBeUndefined();
    });

    test("reconcile never assigns one folder to two types (user override wins)", () => {
        // "Archive" name-matches the archive heuristic, but the user pinned it as Sent.
        const boxes = [fakeMailbox("INBOX"), fakeMailbox("Archive")];
        const existing: SpecialUse.Mapping = { sent: { path: "Archive", source: "user" } };
        const result = SpecialUse.reconcile(existing, boxes);
        expect(result.sent).toEqual({ path: "Archive", source: "user" });
        expect(result.archive).toBeUndefined();   // not re-detected onto a taken folder
    });

    test("reconcile drops a stale null-path archive entry and re-detects", () => {
        const boxes = [fakeMailbox("INBOX"), fakeMailbox("Archive")];
        // Old data from when archive could be an explicit user "none".
        const existing: SpecialUse.Mapping = { archive: { path: null as any, source: "user" } };
        const result = SpecialUse.reconcile(existing, boxes);
        expect(result.archive).toEqual({ path: "Archive", source: "guess" });
    });


    test("apply writes mapped flags and clears stray managed flags", () => {
        const boxes = [
            fakeMailbox("Sent", "\\Sent"),
            fakeMailbox("MyDrafts"),
            fakeMailbox("OldDrafts", "\\Drafts"),
        ];
        const mapping: SpecialUse.Mapping = {
            sent: { path: "Sent", source: "flag" },
            drafts: { path: "MyDrafts", source: "user" },
        };
        const applied = SpecialUse.apply(boxes, mapping);
        expect(applied.find((mb) => mb.path === "Sent")?.specialUse).toBe("\\Sent");
        expect(applied.find((mb) => mb.path === "MyDrafts")?.specialUse).toBe("\\Drafts");
        // OldDrafts carried \Drafts but isn't the mapped drafts folder -> cleared.
        expect(applied.find((mb) => mb.path === "OldDrafts")?.specialUse).toBeUndefined();
    });
});

describe("Mail Special-Use Routes", async () => {

    let specialUseUser: SeededUser;
    let session_token: string;
    let mailAccountID: number;

    const connectionSettings = {
        smtp_host: "127.0.0.1", smtp_port: 11125, smtp_encryption: "NONE",
        smtp_username: "testuser", smtp_password: "testpass",
        imap_host: "127.0.0.1", imap_port: 11143, imap_encryption: "NONE",
        imap_username: "testuser", imap_password: "testpass",
    } as const;

    beforeAll(async () => {
        specialUseUser = await seedUser("user", { username: "specialuseuser" }, "SpecialP@ss1");
        session_token = await seedSession(specialUseUser.id).then(s => s.token);

        const encryptedSMTPData = MailAccountEncryption.encryptSMTPData({
            host: connectionSettings.smtp_host, port: connectionSettings.smtp_port,
            username: connectionSettings.smtp_username, password: connectionSettings.smtp_password,
            useSSL: connectionSettings.smtp_encryption,
        });
        const encryptedIMAPData = MailAccountEncryption.encryptIMAPData({
            host: connectionSettings.imap_host, port: connectionSettings.imap_port,
            username: connectionSettings.imap_username, password: connectionSettings.imap_password,
            useSSL: connectionSettings.imap_encryption,
        });
        if (!encryptedSMTPData || !encryptedIMAPData) throw new Error("Failed to encrypt mail account data");

        mailAccountID = DB.instance().insert(DB.Tables.mailAccounts).values({
            owner_user_id: specialUseUser.id,
            display_name: "Special-Use Test Account",
            smtp_encrypted_connection_data: encryptedSMTPData,
            imap_encrypted_connection_data: encryptedIMAPData,
        }).returning().get().id;
    });

    test("GET /special-use auto-detects and persists the mapping", async () => {
        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/special-use`, {
            authToken: session_token,
            expectedBodySchema: SpecialUseModel.Get.Response,
        });

        // The mock server advertises \Sent / \Drafts / \Junk / \Trash flags.
        expect(data.sent).toEqual({ path: "Sent", source: "flag" });
        expect(data.drafts).toEqual({ path: "Drafts", source: "flag" });
        expect(data.spam).toEqual({ path: "Spam", source: "flag" });
        expect(data.trash).toEqual({ path: "Trash", source: "flag" });
        expect(data.inbox?.path).toBe("INBOX");
        // No archive folder exists on the mock server.
        expect(data.archive).toBeUndefined();

        // The resolved mapping was persisted (one row for the account).
        const rows = DB.instance().select().from(DB.Tables.mailAccountSpecialUse).where(
            eq(DB.Tables.mailAccountSpecialUse.mail_account_id, mailAccountID)
        ).all();
        expect(rows.length).toBe(1);
    });

    test("PUT /special-use overrides a mapping and marks it as user-set", async () => {
        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/special-use`, {
            method: "PUT",
            authToken: session_token,
            body: { drafts: "INBOX/Work" },
            expectedBodySchema: SpecialUseModel.Update.Response,
        });
        expect(data.drafts).toEqual({ path: "INBOX/Work", source: "user" });

        // Persisted and returned by a subsequent GET.
        const after = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/special-use`, {
            authToken: session_token,
            expectedBodySchema: SpecialUseModel.Get.Response,
        });
        expect(after.drafts).toEqual({ path: "INBOX/Work", source: "user" });
    });

    test("mailbox listing reflects the override and clears the stray flag", async () => {
        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes`, {
            authToken: session_token,
            expectedBodySchema: MailboxesModel.GetAll.Response,
        });
        // The overridden folder now carries the \Drafts flag...
        expect(data.find(mb => mb.path === "INBOX/Work")?.specialUse).toBe("\\Drafts");
        // ...and the server's original Drafts folder no longer does.
        expect(data.find(mb => mb.path === "Drafts")?.specialUse).toBeUndefined();
        // Sent is untouched.
        expect(data.find(mb => mb.path === "Sent")?.specialUse).toBe("\\Sent");
    });

    test("PUT /special-use with null reverts a type to auto-detection", async () => {
        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/special-use`, {
            method: "PUT",
            authToken: session_token,
            body: { drafts: null },
            expectedBodySchema: SpecialUseModel.Update.Response,
        });
        expect(data.drafts).toEqual({ path: "Drafts", source: "flag" });
    });

    test("PUT /special-use with empty string reverts archive to auto-detection", async () => {
        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/special-use`, {
            method: "PUT",
            authToken: session_token,
            body: { archive: "" },
            expectedBodySchema: SpecialUseModel.Update.Response,
        });
        // The mock server has no \\Archive flag, so archive is not detected.
        expect(data.archive).toBeUndefined();
    });

    test("PUT /special-use with empty string reverts a required type to auto-detection", async () => {
        const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/special-use`, {
            method: "PUT",
            authToken: session_token,
            body: { spam: "" },
            expectedBodySchema: SpecialUseModel.Update.Response,
        });
        expect(data.spam).toEqual({ path: "Spam", source: "flag" });
    });


    test("PUT /special-use rejects a path that doesn't exist", async () => {
        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/special-use`, {
            method: "PUT",
            authToken: session_token,
            body: { sent: "INBOX/DoesNotExist" },
        }, 400);
    });

    test("GET /special-use without auth fails", async () => {
        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/special-use`, {}, 401);
    });
});
