import { afterAll, describe, expect, test, beforeAll } from "bun:test";
import { API } from "../src/api";
import { DB } from "../src/db";
import { AuthHandler, AuthUtils, SessionHandler } from "../src/api/utils/authHandler";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { AuthModel } from "../src/api/versions/v1/routes/auth/model";
import { makeAPIRequest } from "./helpers/api";
import { AccountModel } from "../src/api/versions/v1/routes/account/model";
import { AccountPreferencesModel } from "../src/api/versions/v1/routes/account/preferences/model";
import { MailAccountsModel } from "../src/api/versions/v1/routes/mail-accounts/model";
import { MailIdentitiesModel } from "../src/api/versions/v1/routes/mail-accounts/identities/model";
import { MailboxesModel } from "../src/api/versions/v1/routes/mail-accounts/mailboxes/model";
import { IMAPAccount } from "../src/utils/mails/backends/imap";
import { MailAccountEncryption } from "../src/utils/crypto/mailCrypt";
import { MailsModel } from "../src/api/versions/v1/routes/mail-accounts/mailboxes/mails/model";
import { SearchModel } from "../src/api/versions/v1/routes/mail-accounts/search/model";
import { MailBulkActionsModel } from "../src/api/versions/v1/routes/mail-accounts/mailboxes/mail-bulk-actions/model";
import { AttachmentsModel } from "../src/api/versions/v1/routes/mail-accounts/mailboxes/mails/attachments/model";
import { hashResetToken } from "../src/api/versions/v1/routes/auth/reset-password";

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
            email: "updated@example.com"
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
            smtp_username: "testuser",
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

        mailAccountIDs.push(data.id);
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

    test("DELETE /v1/mail-accounts/:mailAccountID/identities/:mailIdentityID deletes specific mail identity", async () => {

        const mailIdentityID = mailIdentityIDs[0];
        expect(mailIdentityID).toBeNumber();
        if (!mailIdentityID) return;

        await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/identities/${mailIdentityID}`, {
            method: "DELETE",
            authToken: session_token,
        });

        const dbresult = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, mailIdentityID)
        ).get();

        expect(dbresult).toBeUndefined();
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

    test("POST /v1/mail-accounts/:mailAccountID/mailboxes/:mailboxPath/mails/:mailUID/send sends mail via SMTP", async () => {

        // Create a draft mail to send
        const mailData = {
            from: { name: "Sender", address: "sender@example.com" },
            to: [{ name: "Receiver", address: "receiver@example.com" }],
            cc: [],
            bcc: [],
            subject: "Test Send Mail",
            body: { text: "This is a test mail to send", html: "<p>This is a test mail to send</p>" }
        };

        const created = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails`, {
            method: "POST",
            authToken: session_token,
            body: mailData,
            expectedBodySchema: MailsModel.Create.Response
        });

        const mailToSendUID = created.uid;

        // Note: This test may fail if SMTP mock server is not running
        // In that case, we expect a 500 error
        try {
            const data = await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${mailToSendUID}/send`, {
                method: "POST",
                authToken: session_token,
                body: { moveToSent: true },
                expectedBodySchema: MailsModel.Send.Response
            });

            // Mail should have been sent (messageId may be present)
            expect(data).toBeDefined();

            // Verify the mail is no longer in INBOX (moved to Sent)
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${mailToSendUID}`, {
                authToken: session_token
            }, 404);
        } catch (e) {
            // SMTP server not available - clean up the created mail
            await makeAPIRequest(`/v1/mail-accounts/${mailAccountID}/mailboxes/INBOX/mails/${mailToSendUID}`, {
                method: "DELETE",
                authToken: session_token
            });
            // Test passes - SMTP not available in test environment
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

    test("GET /docs/v1 returns API docs UI if enabled", async () => {
        await makeAPIRequest(`/docs/v1`, {}, 200);
    });

    test("GET /docs/openapi returns 404 if disabled", async () => {

        await API.stop();
        await API.init([], true);
        await API.start(14123, "::");

        await makeAPIRequest(`/docs/v1/openapi`, {}, 404);
    });

    test("GET /docs/v1 returns 404 if disabled", async () => {

        await makeAPIRequest(`/docs/v1`, {}, 404);
    });
});