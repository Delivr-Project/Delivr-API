import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { DB } from "../db";
import { AuthHandler } from "./utils/authHandler";
import { MailAccountEncryption } from "../utils/crypto/mailCrypt";
import { MailClientsCache } from "../utils/mails/mail-clients-cache";
import type { MailAccountsModel } from "./versions/v1/routes/mail-accounts/model";
import type { MailRessource } from "../utils/mails/ressources/mail";

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const accountIdFor = (id: number) => `a${id}`;
const accountIdFrom = (id: string) => id.match(/^a(\d+)$/)?.[1];
const encode = (value: string) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString();

const error = (type: string, description?: string) =>
    ["error", { type, ...(description ? { description } : {}) }] as const;

async function accountsFor(userId: number) {
    return DB.instance().select().from(DB.Tables.mailAccounts).where(
        eq(DB.Tables.mailAccounts.owner_user_id, userId)
    ).all();
}

async function clientFor(userId: number, id: string) {
    const rawId = accountIdFrom(id);
    const account = rawId ? (await accountsFor(userId)).find(a => a.id === Number(rawId)) : undefined;
    if (!account) return null;
    const smtp = MailAccountEncryption.decryptSMTPData(account.smtp_encrypted_connection_data);
    const imap = MailAccountEncryption.decryptIMAPData(account.imap_encrypted_connection_data);
    if (!smtp || !imap) return null;
    const settings = {
        id: account.id, owner_user_id: account.owner_user_id, display_name: account.display_name,
        is_default: account.is_default, smtp_host: smtp.host, smtp_port: smtp.port,
        smtp_username: smtp.username, smtp_password: smtp.password, smtp_encryption: smtp.useSSL,
        imap_host: imap.host, imap_port: imap.port, imap_username: imap.username,
        imap_password: imap.password, imap_encryption: imap.useSSL
    } as MailAccountsModel.BASE;
    const client = MailClientsCache.createOrGetClientData(settings).imap;
    await client.connect();
    return { account, client };
}

function mailboxId(accountId: string, path: string) {
    return `${accountId}:m:${encode(path)}`;
}

function mailboxPath(accountId: string, id: string) {
    const prefix = `${accountId}:m:`;
    return id.startsWith(prefix) ? decode(id.slice(prefix.length)) : null;
}

function emailId(accountId: string, path: string, uid: number) {
    return `${accountId}:e:${encode(path)}:${uid}`;
}

function emailLocation(accountId: string, id: string) {
    const prefix = `${accountId}:e:`;
    if (!id.startsWith(prefix)) return null;
    const value = id.slice(prefix.length);
    const split = value.lastIndexOf(":");
    if (split < 1) return null;
    const uid = Number(value.slice(split + 1));
    return Number.isSafeInteger(uid) ? { path: decode(value.slice(0, split)), uid } : null;
}

function address(value?: MailRessource.EmailAddress) {
    return value ? { email: value.address, name: value.name || null } : null;
}

function addresses(values: MailRessource.EmailAddress[]) {
    return values.map(value => ({ email: value.address, name: value.name || null }));
}

function toEmail(accountId: string, path: string, mail: MailRessource.IMail) {
    const keywords: Record<string, boolean> = {};
    if (mail.flags?.seen) keywords.$seen = true;
    if (mail.flags?.answered) keywords.$answered = true;
    if (mail.flags?.flagged) keywords.$flagged = true;
    if (mail.flags?.draft) keywords.$draft = true;
    if (mail.flags?.deleted) keywords.$deleted = true;
    return {
        id: emailId(accountId, path, mail.uid),
        blobId: emailId(accountId, path, mail.uid),
        threadId: emailId(accountId, path, mail.uid),
        mailboxIds: { [mailboxId(accountId, path)]: true },
        keywords,
        receivedAt: new Date(mail.date || 0).toISOString(),
        sentAt: new Date(mail.date || 0).toISOString(),
        size: 0,
        hasAttachment: mail.attachments.length > 0,
        preview: mail.body.text?.slice(0, 256) || "",
        subject: mail.subject || "",
        from: address(mail.from),
        to: addresses(mail.to),
        cc: addresses(mail.cc),
        bcc: addresses(mail.bcc),
        replyTo: addresses(mail.replyTo || []),
        messageId: mail.messageId ? [mail.messageId] : [],
        inReplyTo: mail.inReplyTo || null,
        references: typeof mail.references === "string" ? [mail.references] : (mail.references || []),
        bodyValues: {
            text: { value: mail.body.text || "", isEncodingProblem: false, isTruncated: false },
            html: { value: mail.body.html || "", isEncodingProblem: false, isTruncated: false }
        },
        attachments: mail.attachments.map(attachment => ({
            blobId: `${emailId(accountId, path, mail.uid)}:${attachment.id}`,
            type: attachment.contentType,
            name: attachment.filename || "",
            size: attachment.size,
            cid: attachment.contentId || null,
            disposition: attachment.contentDisposition || "attachment"
        }))
    };
}

export const jmapRouter = new Hono();

const authenticate = async (c: any, next: any) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const context = token ? await AuthHandler.getAuthContext(token) : null;
    if (!context || !(await AuthHandler.isValidAuthContext(context))) {
        return c.json({ type: "unauthorized", description: "Authentication required" }, 401);
    }
    c.set("jmapAuth", context);
    return next();
};

jmapRouter.use("*", authenticate);

jmapRouter.get("/.well-known/jmap", async c => {
    const auth = c.get("jmapAuth") as AuthHandler.AuthContext;
    const accounts = await accountsFor(auth.user_id);
    const accountMap: Record<string, unknown> = {};
    for (const account of accounts) {
        const id = accountIdFor(account.id);
        accountMap[id] = { name: account.display_name, isReadOnly: false, isPersonal: true, isLocal: false, accountCapabilities: { [MAIL]: {} } };
    }
    return c.json({
        capabilities: { [CORE]: { maxSizeRequest: 40 * 1024 * 1024, maxCallsInRequest: 32 }, [MAIL]: {} },
        accounts: accountMap,
        primaryAccounts: { [MAIL]: accounts[0] ? accountIdFor(accounts[0].id) : null },
        apiUrl: "/jmap/api",
        downloadUrl: null,
        uploadUrl: null,
        eventSourceUrl: null,
        state: "0"
    });
});

async function method(name: string, args: any, auth: AuthHandler.AuthContext): Promise<any> {
    if (name === "Core/echo") return ["Core/echo", args];
    const [type, action] = name.split("/");
    if (type !== "Mailbox" && type !== "Email") return error("unknownMethod");
    const accountId = args.accountId;
    if (typeof accountId !== "string" || !accountIdFrom(accountId)) return error("invalidArguments");
    const selected = await clientFor(auth.user_id, accountId);
    if (!selected) return error("accountNotFound");
    const { client } = selected;

    if (type === "Mailbox" && action === "get") {
        const mailboxes = await client.getMailboxes();
        const ids = Array.isArray(args.ids) ? new Set(args.ids) : null;
        const list = mailboxes.filter(m => !ids || ids.has(mailboxId(accountId, m.path))).map(m => ({
            id: mailboxId(accountId, m.path), name: m.name,
            parentId: m.parentPath ? mailboxId(accountId, m.parentPath) : null,
            role: m.specialUse?.replace(/^\\/, "").toLowerCase() || null,
            sortOrder: 0, totalEmails: m.status.messages, unreadEmails: m.status.unseen,
            totalThreads: m.status.messages, unreadThreads: m.status.unseen
        }));
        return ["Mailbox/get", { accountId, state: "0", list, notFound: [] }];
    }
    if (type === "Mailbox" && action === "query") {
        const mailboxes = await client.getMailboxes();
        const ids = mailboxes.map(m => mailboxId(accountId, m.path));
        return ["Mailbox/query", { accountId, queryState: "0", canCalculateChanges: false, position: 0, ids, total: ids.length }];
    }
    if (type === "Email" && (action === "get" || action === "query")) {
        const mailboxes = await client.getMailboxes();
        const wanted = action === "get" ? new Set(args.ids || []) : null;
        const filter = args.filter || {};
        const mailboxFilter = typeof filter.inMailbox === "string" ? [filter.inMailbox] : filter.inMailbox;
        const selectedMailboxes = Array.isArray(mailboxFilter)
            ? mailboxes.filter(m => mailboxFilter.includes(mailboxId(accountId, m.path)))
            : mailboxes;
        const result: any[] = [];
        const notFound = new Set<string>(args.ids || []);
        for (const mailbox of selectedMailboxes) {
            const mails = await client.getMails(mailbox.path, {
                limit: action === "get" ? 1_000_000 : (args.limit || 256),
                offset: action === "get" ? 0 : (args.position || 0),
                searchString: typeof filter.text === "string" ? filter.text : undefined,
                view: "full"
            });
            for (const mail of mails) {
                const item = toEmail(accountId, mailbox.path, mail);
                if (wanted && !wanted.has(item.id)) continue;
                if (filter.isUnread === true && mail.flags?.seen) continue;
                if (filter.isFlagged === true && !mail.flags?.flagged) continue;
                if (wanted) notFound.delete(item.id);
                result.push(item);
            }
        }
        if (action === "query") return ["Email/query", { accountId, queryState: "0", canCalculateChanges: false, position: 0, ids: result.map(m => m.id), total: result.length }];
        return ["Email/get", { accountId, state: "0", list: result, notFound: [...notFound] }];
    }
    return error("unknownMethod");
}

jmapRouter.post("/jmap/api", async c => {
    const auth = c.get("jmapAuth") as AuthHandler.AuthContext;
    const body = await c.req.json().catch(() => null);
    if (!Array.isArray(body) || body.length > 32) return c.json([error("invalidArguments")], 400);
    const responses = [];
    for (const call of body) {
        if (!Array.isArray(call) || call.length !== 3 || typeof call[0] !== "string") {
            responses.push([...error("invalidArguments"), null]);
            continue;
        }
        try {
            const response = await method(call[0], call[1] || {}, auth);
            responses.push([...response, call[2]]);
        } catch {
            responses.push(["error", { type: "serverFail" }, call[2]]);
        }
    }
    return c.json(responses);
});
