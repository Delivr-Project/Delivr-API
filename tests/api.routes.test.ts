import { afterAll, describe, expect, test } from "bun:test";
import { API } from "../src/api";
import { DB } from "../src/db";
import { AuthHandler, AuthUtils, SessionHandler } from "../src/api/utils/authHandler";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { AuthModel } from "../src/api/routes/auth/model";
import { makeAPIRequest } from "./helpers/api";
import { AccountModel } from "../src/api/routes/account/model";
import { MailAccountsModel } from "../src/api/routes/mail-accounts/model";
import { MailIdentitiesModel } from "../src/api/routes/mail-accounts/identities/model";
import { MailboxesModel } from "../src/api/routes/mail-accounts/mailboxes/model";
import { IMAPAccount } from "../src/utils/mails/backends/imap";

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

    test("DELETE /account fails because of existing mail accounts", async () => {
        
        // Seed a mail account
        const mailAccountID = await DB.instance().insert(DB.Schema.mailAccounts).values({
            owner_user_id: testUser.id,

            display_name: "Test Mail Account",

            smtp_host: "smtp.example.com",
            smtp_port: 587,
            smtp_encryption: "STARTTLS",
            smtp_username: "smtpuser",
            smtp_password: "smtppass",

            imap_host: "imap.example.com",
            imap_port: 993,
            imap_encryption: "SSL",
            imap_username: "imapuser",
            imap_password: "imappass"

        }).returning().get().id;

        await makeAPIRequest("/account", {
            method: "DELETE",
            authToken: session_token
        }, 400);

        await DB.instance().delete(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.id, mailAccountID)
        ).run();
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

describe("Mail Account Routes", async () => {

    const mailAccountTestUser = await seedUser("user", { username: "mailaccountuser" }, "MailAccP@ss1");
    const session_token = await seedSession(mailAccountTestUser.id).then(s => s.token);

    const mailAccountIDs: number[] = [];

    test("POST /mail-accounts creates mail account", async () => {

        const mailAccountData = {
            display_name: "Test Mail Account",

            smtp_host: "smtp.example.com",
            smtp_port: 587,
            smtp_encryption: "STARTTLS" as const,
            smtp_username: "smtpuser",
            smtp_password: "smtppass",

            imap_host: "imap.example.com",
            imap_port: 993,
            imap_encryption: "SSL" as const,
            imap_username: "imapuser",
            imap_password: "imappass",

            is_default: false
        } satisfies MailAccountsModel.CreateMailAccount.Body;

        const data = await makeAPIRequest("/mail-accounts", {
            method: "POST",
            authToken: session_token,
            body: mailAccountData,
            expectedBodySchema: MailAccountsModel.CreateMailAccount.Response
        });

        expect(data.id).toBeGreaterThan(0);

        const dbresult = DB.instance().select().from(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.id, data.id)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(dbresult.smtp_host).toBe(mailAccountData.smtp_host);
        expect(dbresult.smtp_port).toBe(mailAccountData.smtp_port);
        expect(dbresult.smtp_encryption).toBe(mailAccountData.smtp_encryption);
        expect(dbresult.smtp_username).toBe(mailAccountData.smtp_username);
        expect(dbresult.smtp_password).toBe(mailAccountData.smtp_password);
        expect(dbresult.imap_host).toBe(mailAccountData.imap_host);
        expect(dbresult.imap_port).toBe(mailAccountData.imap_port);
        expect(dbresult.imap_encryption).toBe(mailAccountData.imap_encryption);
        expect(dbresult.imap_username).toBe(mailAccountData.imap_username);
        expect(dbresult.imap_password).toBe(mailAccountData.imap_password);

        expect(dbresult.is_default).toBe(mailAccountData.is_default);

        mailAccountIDs.push(data.id);
    });

    test("GET /mail-accounts retrieves mail accounts", async () => {

        const data = await makeAPIRequest("/mail-accounts", {
            authToken: session_token,
            expectedBodySchema: MailAccountsModel.GetAllMailAccounts.Response
        });

        expect(Array.isArray(data)).toBe(true);

        const dbresults = DB.instance().select().from(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.owner_user_id, mailAccountTestUser.id)
        ).orderBy(desc(DB.Schema.mailAccounts.id)).all();

        expect(data.length).toBe(dbresults.length);

        expect(data[0]).toBeDefined();
        if (!data[0]) return;

        expect(dbresults[0]).toBeDefined();
        if (!dbresults[0]) return;

        expect(data[0].id).toBe(dbresults[0]?.id);
        expect(data[0].smtp_host).toBe(dbresults[0]?.smtp_host);
        expect(data[0].imap_host).toBe(dbresults[0]?.imap_host);
        expect(data[0].created_at).toBe(dbresults[0]?.created_at);
        expect(data[0].smtp_port).toBe(dbresults[0]?.smtp_port);
        expect(data[0].smtp_encryption).toBe(dbresults[0]?.smtp_encryption);
        expect(data[0].smtp_username).toBe(dbresults[0]?.smtp_username);
        expect(data[0].imap_port).toBe(dbresults[0]?.imap_port);
        expect(data[0].imap_encryption).toBe(dbresults[0]?.imap_encryption);
        expect(data[0].imap_username).toBe(dbresults[0]?.imap_username);
    });

    test("Get /mail-accounts/:mailAccountID retrieves specific mail account", async () => {

        const mailAccountID = mailAccountIDs[0];
        expect(mailAccountID).toBeNumber();
        if (!mailAccountID) return;

        const data = await makeAPIRequest(`/mail-accounts/${mailAccountID}`, {
            authToken: session_token,
            expectedBodySchema: MailAccountsModel.GetMailAccountByID.Response
        });

        expect(data).toBeDefined();
        if (!data) return;

        expect(data.id).toBe(mailAccountID);

        const dbresult = DB.instance().select().from(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.id, mailAccountID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(data.smtp_host).toBe(dbresult.smtp_host);
        expect(data.smtp_port).toBe(dbresult.smtp_port);
        expect(data.smtp_encryption).toBe(dbresult.smtp_encryption);
        expect(data.smtp_username).toBe(dbresult.smtp_username);
        expect(data.imap_host).toBe(dbresult.imap_host);
        expect(data.imap_port).toBe(dbresult.imap_port);
        expect(data.imap_encryption).toBe(dbresult.imap_encryption);
        expect(data.imap_username).toBe(dbresult.imap_username);
    });

    test("Get /mail-accounts/:mailAccountID with invalid ID fails", async () => {
        
        const invalidMailAccountID = 999999;

        await makeAPIRequest(`/mail-accounts/${invalidMailAccountID}`, {
            authToken: session_token
        }, 404);
    });

    test("PUT /mail-accounts/:mailAccountID updates mail account info", async () => {

        const mailAccountID = mailAccountIDs[0];
        expect(mailAccountID).toBeNumber();
        if (!mailAccountID) return;

        const updatedData = {
            display_name: "Updated Mail Account",
            is_default: true
        } satisfies MailAccountsModel.UpdateMailAccountInfo.Body;

        await makeAPIRequest(`/mail-accounts/${mailAccountID}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        });

        const dbresult = DB.instance().select().from(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.id, mailAccountID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(dbresult.display_name).toBe(updatedData.display_name);
        expect(dbresult.is_default).toBe(updatedData.is_default);
    });

    test("PUT /mail-accounts/:mailAccountID with invalid ID fails", async () => {

        const invalidMailAccountID = 999999;

        const updatedData = {
            display_name: "Updated Mail Account",
            is_default: true
        } satisfies MailAccountsModel.UpdateMailAccountInfo.Body;

        await makeAPIRequest(`/mail-accounts/${invalidMailAccountID}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        }, 404);
    });

    test("PUT /mail-accounts/:mailAccountID/credentials updates specific mail account", async () => {

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

        await makeAPIRequest(`/mail-accounts/${mailAccountID}/credentials`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        });

        const dbresult = DB.instance().select().from(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.id, mailAccountID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(dbresult.smtp_host).toBe(updatedData.smtp_host);
        expect(dbresult.smtp_port).toBe(updatedData.smtp_port);
        expect(dbresult.smtp_encryption).toBe(updatedData.smtp_encryption);
        expect(dbresult.smtp_username).toBe(updatedData.smtp_username);
        expect(dbresult.smtp_password).toBe(updatedData.smtp_password);

        expect(dbresult.imap_host).toBe(updatedData.imap_host);
        expect(dbresult.imap_port).toBe(updatedData.imap_port);
        expect(dbresult.imap_encryption).toBe(updatedData.imap_encryption);
        expect(dbresult.imap_username).toBe(updatedData.imap_username);
        expect(dbresult.imap_password).toBe(updatedData.imap_password);
    });

    test("PUT /mail-accounts/:mailAccountID/credentials with invalid ID fails", async () => {
        
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

        await makeAPIRequest(`/mail-accounts/${invalidMailAccountID}/credentials`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        }, 404);
    });

    test("DELETE /mail-accounts/:mailAccountID deletes specific mail account", async () => {

        const mailAccountID = mailAccountIDs[0];
        expect(mailAccountID).toBeNumber();
        if (!mailAccountID) return;

        await makeAPIRequest(`/mail-accounts/${mailAccountID}`, {
            method: "DELETE",
            authToken: session_token,
        });

        const dbresult = DB.instance().select().from(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.id, mailAccountID)
        ).get();

        expect(dbresult).toBeUndefined();
    });

    test("DELETE /mail-accounts/:mailAccountID with invalid ID fails", async () => {
        
        const invalidMailAccountID = 999999;

        await makeAPIRequest(`/mail-accounts/${invalidMailAccountID}`, {
            method: "DELETE",
            authToken: session_token,
        }, 404);
    });

    afterAll(async () => {
        SessionHandler.inValidateAllSessionsForUser(mailAccountTestUser.id);

        DB.instance().delete(DB.Schema.users).where(
            eq(DB.Schema.users.id, mailAccountTestUser.id)
        ).run();
    });

});

describe("Mail Identity Routes", async () => {
    
    const mailIdentityTestUser = await seedUser("user", { username: "mailidentityuser" }, "MailIdentP@ss1");
    const session_token = await seedSession(mailIdentityTestUser.id).then(s => s.token);

    const mailAccountID = DB.instance().insert(DB.Schema.mailAccounts).values({
        owner_user_id: mailIdentityTestUser.id,

        display_name: "Test Mail Account",

        smtp_host: "smtp.example.com",
        smtp_port: 587,
        smtp_encryption: "STARTTLS",
        smtp_username: "smtpuser",
        smtp_password: "smtppass",

        imap_host: "imap.example.com",
        imap_port: 993,
        imap_encryption: "SSL",
        imap_username: "imapuser",
        imap_password: "imappass"

    }).returning().get().id;
    
    const mailIdentityIDs: number[] = [];

    test("POST /mail-accounts/:mailAccountID/identities creates mail identity", async () => {

        const mailIdentityData = {
            display_name: "Test Identity",
            email_address: "test@example.com",
            is_default: false
        } satisfies MailIdentitiesModel.CreateMailIdentity.Body;

        const data = await makeAPIRequest(`/mail-accounts/${mailAccountID}/identities`, {
            method: "POST",
            authToken: session_token,
            body: mailIdentityData,
            expectedBodySchema: MailIdentitiesModel.CreateMailIdentity.Response
        });

        expect(data.id).toBeGreaterThan(0);

        const dbresult = DB.instance().select().from(DB.Schema.mailIdentities).where(
            eq(DB.Schema.mailIdentities.id, data.id)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(dbresult.display_name).toBe(mailIdentityData.display_name);
        expect(dbresult.email_address).toBe(mailIdentityData.email_address);
        expect(dbresult.is_default).toBe(mailIdentityData.is_default);

        mailIdentityIDs.push(data.id);
    });

    test("GET /mail-accounts/:mailAccountID/identities retrieves mail identities", async () => {

        const data = await makeAPIRequest(`/mail-accounts/${mailAccountID}/identities`, {
            authToken: session_token,
            expectedBodySchema: MailIdentitiesModel.GetAll.Response
        });

        expect(Array.isArray(data)).toBe(true);

        const dbresults = DB.instance().select().from(DB.Schema.mailIdentities).where(
            eq(DB.Schema.mailIdentities.mail_account_id, mailAccountID)
        ).orderBy(desc(DB.Schema.mailIdentities.id)).all();

        expect(data.length).toBe(dbresults.length);

        expect(data[0]).toBeDefined();
        if (!data[0]) return;

        expect(dbresults[0]).toBeDefined();
        if (!dbresults[0]) return;

        expect(data[0].id).toBe(dbresults[0]?.id);
        expect(data[0].display_name).toBe(dbresults[0]?.display_name);
        expect(data[0].email_address).toBe(dbresults[0]?.email_address);

    });

    test("GET /mail-accounts/:mailAccountID/identities/:mailIdentityID retrieves specific mail identity", async () => {

        const mailIdentityID = mailIdentityIDs[0];
        expect(mailIdentityID).toBeNumber();
        if (!mailIdentityID) return;

        const data = await makeAPIRequest(`/mail-accounts/${mailAccountID}/identities/${mailIdentityID}`, {
            authToken: session_token,
            expectedBodySchema: MailIdentitiesModel.GetByID.Response
        });

        expect(data).toBeDefined();
        if (!data) return;

        expect(data.id).toBe(mailIdentityID);

        const dbresult = DB.instance().select().from(DB.Schema.mailIdentities).where(
            eq(DB.Schema.mailIdentities.id, mailIdentityID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(data.display_name).toBe(dbresult.display_name);
        expect(data.email_address).toBe(dbresult.email_address);
    });

    test("GET /mail-accounts/:mailAccountID/identities/:mailIdentityID with invalid ID fails", async () => {
        
        const invalidMailIdentityID = 999999;

        await makeAPIRequest(`/mail-accounts/${mailAccountID}/identities/${invalidMailIdentityID}`, {
            authToken: session_token
        }, 404);

    });

    test("PUT /mail-accounts/:mailAccountID/identities/:mailIdentityID updates specific mail identity", async () => {

        const mailIdentityID = mailIdentityIDs[0];
        expect(mailIdentityID).toBeNumber();
        if (!mailIdentityID) return;

        const updatedData = {
            display_name: "Updated Identity",
            email_address: "new@example.com",
            is_default: false
        } satisfies MailIdentitiesModel.CreateMailIdentity.Body;

        await makeAPIRequest(`/mail-accounts/${mailAccountID}/identities/${mailIdentityID}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        });

        const dbresult = DB.instance().select().from(DB.Schema.mailIdentities).where(
            eq(DB.Schema.mailIdentities.id, mailIdentityID)
        ).get();

        expect(dbresult).toBeDefined();
        if (!dbresult) return;

        expect(dbresult.display_name).toBe(updatedData.display_name);
        expect(dbresult.email_address).toBe(updatedData.email_address);
        expect(dbresult.is_default).toBe(updatedData.is_default);
    });

    test("PUT /mail-accounts/:mailAccountID/identities/:mailIdentityID with invalid ID fails", async () => {
        
        const invalidMailIdentityID = 999999;

        const updatedData = {
            display_name: "Updated Identity",
            email_address: "new@example.com",
            is_default: false
        } satisfies MailIdentitiesModel.CreateMailIdentity.Body;

        await makeAPIRequest(`/mail-accounts/${mailAccountID}/identities/${invalidMailIdentityID}`, {
            method: "PUT",
            authToken: session_token,
            body: updatedData
        }, 404);
    });

    test("DELETE /mail-accounts/:mailAccountID/identities/:mailIdentityID deletes specific mail identity", async () => {

        const mailIdentityID = mailIdentityIDs[0];
        expect(mailIdentityID).toBeNumber();
        if (!mailIdentityID) return;

        await makeAPIRequest(`/mail-accounts/${mailAccountID}/identities/${mailIdentityID}`, {
            method: "DELETE",
            authToken: session_token,
        });

        const dbresult = DB.instance().select().from(DB.Schema.mailIdentities).where(
            eq(DB.Schema.mailIdentities.id, mailIdentityID)
        ).get();

        expect(dbresult).toBeUndefined();
    });

    test("DELETE /mail-accounts/:mailAccountID/identities/:mailIdentityID with invalid ID fails", async () => {
        
        const invalidMailIdentityID = 999999;

        await makeAPIRequest(`/mail-accounts/${mailAccountID}/identities/${invalidMailIdentityID}`, {
            method: "DELETE",
            authToken: session_token,
        }, 404);
    
    });

    afterAll(async () => {

        SessionHandler.inValidateAllSessionsForUser(mailIdentityTestUser.id);

        DB.instance().delete(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.id, mailAccountID)
        ).run();

        DB.instance().delete(DB.Schema.users).where(
            eq(DB.Schema.users.id, mailIdentityTestUser.id)
        ).run();
    });
});

describe("Mail Mailbox Routes", async () => {

    const mailIdentityTestUser = await seedUser("user", { username: "mailfoldersuser" }, "MailFoldP@ss1");
    const session_token = await seedSession(mailIdentityTestUser.id).then(s => s.token);

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

    const testIMAPClient = await IMAPAccount.fromConfig({
        host: connectionSettings.imap_host,
        port: connectionSettings.imap_port,
        username: connectionSettings.imap_username,
        password: connectionSettings.imap_password,
        useSSL: connectionSettings.imap_encryption
    }).connect();

    const mailAccountID = DB.instance().insert(DB.Schema.mailAccounts).values({
        owner_user_id: mailIdentityTestUser.id,
        display_name: "Test Mail Account",
        ...connectionSettings
    }).returning().get().id;
    
    test("POST /mail-accounts/:mailAccountID/mailboxes creates new mailbox / folder", async () => {

        const mailboxData = {
            path: "INBOX/Social Media",
        } satisfies MailboxesModel.Create.Body;

        const data = await makeAPIRequest(`/mail-accounts/${mailAccountID}/mailboxes`, {
            method: "POST",
            authToken: session_token,
            body: mailboxData
        });

        expect(data).toBeNull();

        expect(await testIMAPClient.getMailbox(mailboxData.path)).not.toBeNull();
    });

    test("GET /mail-accounts/:mailAccountID/mailboxes retrieves mail mailboxes", async () => {

        const data = await makeAPIRequest(`/mail-accounts/${mailAccountID}/mailboxes`, {
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

    test("GET /mail-accounts/:mailAccountID/mailboxes/:mailboxPath retrieves specific mail mailbox", async () => {

        const mailboxPath = "INBOX/Social Media";

        const data = await makeAPIRequest(`/mail-accounts/${mailAccountID}/mailboxes/${encodeURIComponent(mailboxPath)}`, {
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

    test("GET /mail-accounts/:mailAccountID/mailboxes/:mailboxPath with invalid path fails", async () => {
        
        const invalidMailboxPath = "NONEXISTENT";

        await makeAPIRequest(`/mail-accounts/${mailAccountID}/mailboxes/${encodeURIComponent(invalidMailboxPath)}`, {
            authToken: session_token
        }, 404);

    });

});

describe("Docs Routes", async () => {

    test("GET /docs/openapi returns API docs if enabled", async () => {
        await makeAPIRequest(`/docs/openapi`, {}, 200);
    });

    test("GET /docs returns API docs UI if enabled", async () => {
        await makeAPIRequest(`/docs`, {}, 200);
    });

    test("GET /docs/openapi returns 404 if disabled", async () => {

        await API.stop();
        await API.init([], true);
        await API.start(14123, "::");

        await makeAPIRequest(`/docs/openapi`, {}, 404);
    });

    test("GET /docs returns 404 if disabled", async () => {

        await makeAPIRequest(`/docs`, {}, 404);
    });
});