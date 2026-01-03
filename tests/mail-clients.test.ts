import { describe, expect, beforeAll, afterAll, test } from "bun:test";
import { IMAPAccount } from "../src/utils/mails/backends/imap";


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