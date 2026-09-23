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

    test("uses the UID from APPENDUID on a UIDPLUS server", async () => {
        const server = new MockIMAPServer({
            plugins: ["ID", "STARTTLS", "SASL-IR", "AUTH-PLAIN", "NAMESPACE", "IDLE", "ENABLE", "CONDSTORE", "LITERALPLUS", "UNSELECT", "SPECIAL-USE", "UIDPLUS"],
            id: { name: "Mock_IMAP UIDPLUS Server", version: "1.0.0" },
            storage: {
                "INBOX": { messages: [{ raw: "Subject: existing\r\n\r\nbody" }] },
                "": { separator: "/", folders: { "Drafts": { "special-use": "\\Drafts" } } }
            },
            debug: false
        });
        server.listen(11144);
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
