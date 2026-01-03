import { describe, expect, beforeAll, afterAll, test } from "bun:test";
import { MockIMAPServer } from "./helpers/mock-mail-servers/imap/server";
import { IMAPAccount } from "../src/utils/mails/backends/imap";

const mockIMAPServer = new MockIMAPServer({
    plugins: ["ID", "STARTTLS" /*, "LOGINDISABLED"*/ , "SASL-IR", "AUTH-PLAIN", "NAMESPACE", "IDLE", "ENABLE", "CONDSTORE", "XTOYBIRD", "LITERALPLUS", "UNSELECT", "SPECIAL-USE", "CREATE-SPECIAL-USE"],
    id: {
        name: "Mock_IMAP Server",
        version: "1.0.0",
    },
    storage: {
        "INBOX": {
            messages: [{
                raw: "Subject: hello 1\r\n\r\nWorld 1!",
                internaldate: "14-Sep-2013 21:22:28 -0300"
            }, {
                raw: "Subject: hello 2\r\n\r\nWorld 2!",
                flags: ["\\Seen"]
            }, {
                raw: "Subject: hello 3\r\n\r\nWorld 3!"
            }, {
                raw: "From: sender name <sender@example.com>\r\n" +
                    "To: Receiver name <receiver@example.com>\r\n" +
                    "Subject: hello 4\r\n" +
                    "Message-Id: <abcde>\r\n" +
                    "Date: Fri, 13 Sep 2013 15:01:00 +0300\r\n" +
                    "\r\n" +
                    "World 4!"
            }, {
                raw: "Subject: hello 5\r\n\r\nWorld 5!"
            }, {
                raw: "Subject: hello 6\r\n\r\nWorld 6!"
            }]
        },
        "": {
            "separator": "/",
            "folders": {
                "[Gmail]": {
                    "flags": ["\\Noselect"],
                    "folders": {
                        "All Mail": {
                            "special-use": "\\All"
                        },
                        "Drafts": {
                            "special-use": "\\Drafts"
                        },
                        "Important": {
                            "special-use": "\\Important"
                        },
                        "Sent Mail": {
                            "special-use": "\\Sent"
                        },
                        "Spam": {
                            "special-use": "\\Junk"
                        },
                        "Starred": {
                            "special-use": "\\Flagged"
                        },
                        "Trash": {
                            "special-use": "\\Trash"
                        }
                    }
                }
            }
        }
    },
    debug: false
});

describe("IMAP Mail Client Tests", () => {

    mockIMAPServer.listen(11143);
    // const port = (mockIMAPServer.server.address() as any).port as number;
    const port = 11143;
    
    const account = IMAPAccount.fromConfig({
        host: "127.0.0.1",
        port,
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
        mockIMAPServer.close();
    });

    
    test("Get All Mailboxes", async () => {
        const mailboxes = await account.getMailboxes();
        expect(mailboxes).toBeDefined();
        expect(mailboxes.length).toBeGreaterThan(0);

        expect(mailboxes.find(mb => mb.name === "INBOX")).toBeDefined();
    });

    test("Get INBOX Status", async () => {

        const inbox = await account.getMailboxStatus("INBOX");
        expect(inbox).toBeDefined();

        if (!inbox) return;

        expect(inbox.messages).toBe(6);
        expect(inbox.recent).toBe(0);
        expect(inbox.unseen).toBe(5);

    });

    test

});