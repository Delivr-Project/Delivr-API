import { describe, expect, beforeAll, afterAll, test, spyOn } from "bun:test";
import { IMAPAccount } from "../src/utils/mails/backends/imap";
import { MockIMAPServer } from "./helpers/mock-mail-servers/imap/server";


describe("IMAP Mail Client Tests", () => {
    
    const account = IMAPAccount.fromConfig({
        host: "127.0.0.1",
        port: 11143,
        username: "testuser",
        password: "testpass",
        useSSL: "NONE"
    });

    beforeAll(async () => {
        // Give some time for the server to start
        Bun.sleep(100);
        await account.connect();
    });

    afterAll(async () => {
        await account.disconnect();
    });

    
    test("Get All Mailboxes", async () => {
        const mailboxes = await account.getMailboxes();
        expect(mailboxes).toBeDefined();

        expect(mailboxes.length).toBe(7);

        expect(mailboxes.find(mb => mb.name === "INBOX")).toBeDefined();
        expect(mailboxes.find(mb => mb.path === "INBOX/Privat" && mb.name === "Privat")).toBeDefined();
        expect(mailboxes.find(mb => mb.path === "INBOX/Work" && mb.name === "Work")).toBeDefined();
        expect(mailboxes.find(mb => mb.name === "Sent")).toBeDefined();
        expect(mailboxes.find(mb => mb.name === "Drafts")).toBeDefined();
        expect(mailboxes.find(mb => mb.name === "Spam")).toBeDefined();
        expect(mailboxes.find(mb => mb.name === "Trash")).toBeDefined();
    });

    test("Get INBOX Status", async () => {

        const inbox = await account.getMailboxStatus("INBOX");
        expect(inbox).toBeDefined();

        if (!inbox) return;

        expect(inbox.messages).toBe(6);
        expect(inbox.recent).toBe(0);
        expect(inbox.unseen).toBe(5);

    });    

});

describe("IMAP createMail returns the new UID", () => {

    const draft = "From: sender@example.com\r\nSubject: createMail uid test\r\n\r\nbody";

    function testAccount(port: number) {
        return IMAPAccount.fromConfig({
            host: "127.0.0.1",
            port,
            username: "testuser",
            password: "testpass",
            useSSL: "NONE"
        });
    }

    /** A fresh mock server (not shared with other tests) with an empty Drafts folder. */
    function startMockServer(port: number, extraPlugins: string[] = []) {
        const server = new MockIMAPServer({
            plugins: ["ID", "STARTTLS", "SASL-IR", "AUTH-PLAIN", "NAMESPACE", "IDLE", "ENABLE", "CONDSTORE", "LITERALPLUS", "UNSELECT", "SPECIAL-USE", ...extraPlugins],
            id: { name: "Mock_IMAP Server", version: "1.0.0" },
            storage: {
                "INBOX": { messages: [{ raw: "Subject: existing\r\n\r\nbody" }] },
                "": { separator: "/", folders: { "Drafts": { "special-use": "\\Drafts" } } }
            },
            debug: false
        });
        server.listen(port);
        return server;
    }

    test("uses the UID from APPENDUID on a UIDPLUS server", async () => {
        const server = startMockServer(11144, ["UIDPLUS"]);
        const account = testAccount(11144);

        try {
            await account.connect();
            const search = spyOn((account as any).client, "search");

            const uid = await account.createMail("Drafts", draft);

            expect(search).not.toHaveBeenCalled();
            search.mockRestore();
            expect(uid).toBeGreaterThan(0);
            const snapshot = await account.getMailSnapshot("Drafts", uid!);
            expect(snapshot?.mail.subject).toBe("createMail uid test");
        } finally {
            await account.disconnect();
            server.close();
        }
    });

    test("finds the appended message on a server without UIDPLUS", async () => {
        const account = testAccount(11143);
        let uid: number | null = null;

        try {
            await account.connect();
            uid = await account.createMail("Drafts", draft);

            expect(uid).toBeGreaterThan(0);
            const snapshot = await account.getMailSnapshot("Drafts", uid!);
            expect(snapshot?.mail.subject).toBe("createMail uid test");
        } finally {
            if (uid) await account.permanentlyDelete("Drafts", [uid]);
            await account.disconnect();
        }
    });

    test("lists mail appended to a mailbox that was empty when it was selected", async () => {
        const server = startMockServer(11145);
        const account = testAccount(11145);

        try {
            await account.connect();
            // Selecting the empty mailbox caches `exists = 0`, and this server
            // doesn't report the session's own append with a new EXISTS.
            expect(await account.getMails("Drafts")).toEqual([]);

            await account.createMail("Drafts", draft);

            expect((await account.getMails("Drafts")).map(mail => mail.subject)).toEqual(["createMail uid test"]);
        } finally {
            await account.disconnect();
            server.close();
        }
    });

    test("returns null when no UID is reported and the mailbox search finds nothing", async () => {
        const account = testAccount(11143);
        const client = (account as any).client;
        spyOn(client, "getMailboxLock").mockResolvedValue({ release() {} });
        spyOn(client, "append").mockResolvedValue({ destination: "Drafts" });
        const search = spyOn(client, "search");

        search.mockResolvedValueOnce(false);
        expect(await account.createMail("Drafts", draft)).toBeNull();

        search.mockResolvedValueOnce([]);
        expect(await account.createMail("Drafts", draft)).toBeNull();
    });

});
