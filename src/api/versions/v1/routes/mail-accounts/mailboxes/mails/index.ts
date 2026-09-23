import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MailsModel } from "./model";
import { APIResponse } from "../../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../../docs";
import { validator } from "hono-openapi";
import { MailAccountsModel } from "../../model";
import { router as attachmentsRouter } from "./attachments";
import { MailClientsCache } from "../../../../../../../utils/mails/mail-clients-cache";
import { Logger } from "../../../../../../../utils/logger";
import { MailboxesModel } from "../model";
import { MailboxService } from "../../../../../../utils/services/maiboxService";
import { SpecialUseHandler } from "../../../../../../utils/services/specialUseService";
import { SMTPAccount } from "../../../../../../../utils/mails/backends/smtp";
import { MailRessource } from "../../../../../../../utils/mails/ressources/mail";
import MailComposer from "nodemailer/lib/mail-composer";
import type Mail from "nodemailer/lib/mailer";
import type { z } from "zod";
import { MailParser } from "../../../../../../../utils/mails/parser";
import type { IMAPAccount } from "../../../../../../../utils/mails/backends/imap";
import { ConfigHandler } from "../../../../../../../utils/config";



function formatEmailAddress(addr: { name?: string; address: string }): string {
    return addr.name ? `"${addr.name}" <${addr.address}>` : addr.address;
}

/** Attachment handed to `MailComposer`, held in memory only while composing. */
type ComposerAttachment = {
    filename?: string;
    content: Buffer;
    contentType?: string;
    cid?: string;
    contentDisposition?: 'attachment' | 'inline';
};

const DEFAULT_MAX_ATTACHMENT_SIZE_MB = 25;
// Allowance on top of the attachment limit for everything else in a create or
// update request (mail JSON, text/HTML bodies, multipart framing). It is a
// memory-safety guard for reading the body, not part of attachment validation.
const MAIL_REQUEST_OVERHEAD_BYTES = 16 * 1024 * 1024;

/** Priority headers, as nodemailer writes them when sending through a transport. */
const PRIORITY_HEADERS: Record<'high' | 'low', Record<string, string>> = {
    high: { 'X-Priority': '1 (Highest)', 'X-MSMail-Priority': 'High', 'Importance': 'High' },
    low: { 'X-Priority': '5 (Lowest)', 'X-MSMail-Priority': 'Low', 'Importance': 'Low' }
};

/** Combined attachment size allowed on a single mail, in bytes. */
function maxAttachmentSize(): number {
    const configured = Number(ConfigHandler.getConfig()?.DLA_MAX_ATTACHMENT_SIZE_MB);
    const megabytes = Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_MAX_ATTACHMENT_SIZE_MB;

    return megabytes * 1024 * 1024;
}

function attachmentLimitError(): string {
    return `Attachments exceed the maximum combined size of ${maxAttachmentSize() / (1024 * 1024)} MB`;
}

/** Total size allowed for a create or update request body, in bytes. */
function maxMailBodySize(): number {
    return maxAttachmentSize() + MAIL_REQUEST_OVERHEAD_BYTES;
}

function mailBodyLimitError(isMultipart: boolean): string {
    const maxSizeMb = maxMailBodySize() / (1024 * 1024);
    return isMultipart
        ? `Multipart request exceeds the maximum total size of ${maxSizeMb} MB (mail JSON, attachments and framing combined)`
        : `Request body exceeds the maximum size of ${maxSizeMb} MB`;
}

function isMultipartRequest(c: Context): boolean {
    return (c.req.header('content-type') ?? '').toLowerCase().includes('multipart/form-data');
}

/** Hono's body-limit middleware errors the request stream with a `BodyLimitError`. */
function isBodyLimitError(error: unknown): boolean {
    return error instanceof Error && error.name === 'BodyLimitError';
}

/**
 * Bound create and update request bodies while they are read, regardless of
 * encoding. This is a memory-safety guard for the whole request; attachment
 * sizes are validated separately after parsing, so large (but valid) mail JSON
 * does not consume the configured attachment allowance.
 *
 * Requests with a `Content-Length` are rejected here before anything is read.
 * Chunked bodies are cut off while being read; {@link readMailPayload} turns
 * that into the same response.
 */
const enforceMailBodyLimit: MiddlewareHandler = async (c, next) => {
    return bodyLimit({
        maxSize: maxMailBodySize(),
        onError: context => APIResponse.badRequest(context, mailBodyLimitError(isMultipartRequest(context)))
    })(c, next);
};

/**
 * Build a draft's MIME source. Bcc stays in the stored draft so the send route
 * can put those recipients in the SMTP envelope; `SMTPAccount.sendRaw` removes
 * the header before delivery. MailComposer has no option for this, so the flag
 * is set on the compiled root node. The same goes for the priority headers,
 * which nodemailer only writes when sending through a transport.
 */
async function buildDraftMessage(options: Mail.Options): Promise<Buffer> {
    const root = new MailComposer(options).compile();
    root.keepBcc = true;
    if (options.priority === 'high' || options.priority === 'low') {
        for (const [key, value] of Object.entries(PRIORITY_HEADERS[options.priority])) {
            root.setHeader(key, value);
        }
    }
    return root.build();
}

/**
 * Read a mail payload from either a JSON body or a `multipart/form-data` body
 * carrying attachments, validated against `schema`.
 *
 * In the multipart case the mail itself arrives as a JSON string in the `mail`
 * field and each file as an `attachments` entry. The files are returned unread,
 * so the caller can check its attachment limit before buffering them; they are
 * only held in memory while the message is composed — nothing is written to disk.
 *
 * @returns The validated body plus attached files, or an error message to return as a 400
 */
async function readMailPayload<S extends z.ZodType>(c: Context, schema: S): Promise<
    { ok: true; body: z.output<S>; files: File[] } |
    { ok: false; error: string }
> {
    const isMultipart = isMultipartRequest(c);

    let rawBody: unknown;
    let files: File[] = [];

    if (isMultipart) {
        let form: FormData;
        try {
            form = await c.req.formData();
        } catch (error) {
            // A chunked body over the size limit fails while it is read. Answer it
            // here instead of rethrowing, so the global error handler doesn't log
            // an ordinary client error as a server error.
            if (isBodyLimitError(error)) return { ok: false, error: mailBodyLimitError(true) };
            return { ok: false, error: "Malformed multipart/form-data body" };
        }

        const mailField = form.get('mail');
        if (typeof mailField !== 'string') {
            return { ok: false, error: "Missing 'mail' field in multipart body" };
        }

        try {
            rawBody = JSON.parse(mailField);
        } catch {
            return { ok: false, error: "The 'mail' field is not valid JSON" };
        }

        const attachmentEntries = form.getAll('attachments');
        if (attachmentEntries.some(entry => !(entry instanceof File))) {
            return { ok: false, error: "Every 'attachments' field must contain a file" };
        }
        files = attachmentEntries as File[];
    } else {
        try {
            rawBody = await c.req.json();
        } catch (error) {
            if (isBodyLimitError(error)) return { ok: false, error: mailBodyLimitError(false) };
            return { ok: false, error: "Malformed JSON body" };
        }
    }

    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) {
        // Match the app-wide validation-error message produced by the global
        // HTTPException handler; Zod details are intentionally not leaked.
        return { ok: false, error: "Your input is invalid" };
    }

    return { ok: true, body: parsed.data, files };
}

function totalFileSize(files: File[]): number {
    return files.reduce((sum, file) => sum + file.size, 0);
}

/** Buffer uploaded files for `MailComposer`. */
async function toComposerAttachments(files: File[]): Promise<ComposerAttachment[]> {
    return Promise.all(files.map(async file => ({
        filename: file.name || 'attachment',
        content: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || undefined
    })));
}

/**
 * File a sent draft in the account's Sent folder: clear `\Draft` so the copy
 * isn't listed as a draft, mark it read and move it. Returns `false` when the
 * account has no Sent folder, leaving the mail where it is.
 *
 * The flags are cleared first, on purpose: filing is best effort, but a mail
 * that has already gone out must never look like an unsent draft again, or the
 * user sends it a second time from their drafts list.
 */
async function fileSentMail(imap: IMAPAccount, accountId: number, mailboxPath: string, uid: number): Promise<boolean> {
    await imap.removeFlags(mailboxPath, [uid], ['\\Draft']);
    await imap.addFlags(mailboxPath, [uid], ['\\Seen']);

    const sentPath = await SpecialUseHandler.resolveSentPath(accountId, imap);
    if (!sentPath) return false;

    if (sentPath !== mailboxPath) await imap.moveToMailbox(mailboxPath, [uid], sentPath);
    return true;
}



export const router = new Hono();

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List Mails",
        description: "Retrieve a list of mails for a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mails retrieved successfully", MailsModel.GetAll.Response),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    validator('query', MailsModel.GetAll.Query),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;

        const query = c.req.valid('query');
        

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const mails = await imap.getMails(mailbox.path, {
                order: query.order,
                limit: query.limit,
                offset: query.offset,
                searchString: query.searchString
            });

            return APIResponse.success(c, "Mails retrieved successfully", mails satisfies MailsModel.GetAll.Response);
        } catch (e) {
            Logger.error("Failed to fetch mails", e);
            return APIResponse.serverError(c, "Failed to fetch mails");
        }
    }
);

router.post('/',

    enforceMailBodyLimit,

    APIRouteSpec.authenticated({
        summary: "Create Mail",
        description: "Create a new mail in the current mailbox (e.g., a draft). Supports JSON bodies and multipart bodies with attachments. Multipart requests have a total size limit of DLA_MAX_ATTACHMENT_SIZE_MB + 16 MB, including mail JSON, attachments and framing; attachments separately must fit DLA_MAX_ATTACHMENT_SIZE_MB.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],
        requestBody: {
            required: true,
            content: {
                "application/json": { schema: MailsModel.Create.JsonSchema },
                "multipart/form-data": { schema: MailsModel.Create.MultipartSchema }
            }
        },

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail created successfully", MailsModel.Create.Response),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;

        const payload = await readMailPayload(c, MailsModel.Create.Body);
        if (!payload.ok) return APIResponse.badRequest(c, payload.error);

        const { body, files } = payload;
        if (totalFileSize(files) > maxAttachmentSize()) {
            return APIResponse.badRequest(c, attachmentLimitError());
        }
        const attachments = await toComposerAttachments(files);

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            const message = await buildDraftMessage({
                from: body.from ? formatEmailAddress(body.from) : undefined,
                to: body.to?.map(formatEmailAddress),
                cc: body.cc?.map(formatEmailAddress),
                bcc: body.bcc?.map(formatEmailAddress),
                replyTo: body.replyTo?.map(formatEmailAddress),
                inReplyTo: body.inReplyTo,
                references: Array.isArray(body.references) ? body.references.join(' ') : body.references,
                subject: body.subject,
                text: body.body?.text,
                html: body.body?.html,
                priority: body.priority,
                attachments
            });

            await imap.connect();
            const createdUid = await imap.createMail(mailbox.path, message, MailParser.getRawFlags(body.flags || {}));

            return APIResponse.success(c, "Mail created successfully", {
                uid: createdUid ?? 0,
                attachments: await MailParser.getAttachmentMetadata(message)
            } satisfies MailsModel.Create.Response);
        } catch (e) {
            Logger.error("Failed to create mail", e);
            return APIResponse.serverError(c, "Failed to create mail");
        }
    }
);


router.use('/:mailUID/*',
    
    validator('param', MailsModel.Param),

    async (c, next) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;

        // @ts-ignore
        const { mailUID } = c.req.valid('param') as MailsModel.Param;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const snapshot = await imap.getMailSnapshot(mailbox.path, mailUID);

            if (!snapshot) {
                return APIResponse.notFound(c, "Mail with specified UID not found");
            }

            // @ts-ignore
            c.set("mailData", snapshot.mail);
            // @ts-ignore
            c.set("mailSource", snapshot.source);

            await next();
        } catch (e) {
            Logger.error(`Failed to fetch mail with UID ${mailUID}`, e);
            return APIResponse.serverError(c, `Failed to fetch mail with UID ${mailUID}`);
        }
    }
);

router.get('/:mailUID',

    APIRouteSpec.authenticated({
        summary: "Get Mail",
        description: "Retrieve a specific mail.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail retrieved successfully", MailsModel.GetByUID.Response),
            APIResponseSpec.notFound("Mail with specified UID not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailData = c.get("mailData") as MailRessource.IMail;

        return APIResponse.success(c, "Mail retrieved successfully", mailData satisfies MailsModel.GetByUID.Response);
    }
);

router.put('/:mailUID',

    enforceMailBodyLimit,

    APIRouteSpec.authenticated({
        summary: "Update Mail",
        description: "Update a mail's content, attachments or flags (for drafts). Content and attachment changes replace the mail with a new one (new UID) and remove the old version; flag-only changes are applied in place. Supports JSON bodies and multipart bodies that add attachments, with the same size limits as creating a mail; `removeAttachments` drops existing attachments by id.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],
        requestBody: {
            required: true,
            content: {
                "application/json": { schema: MailsModel.Update.JsonSchema },
                "multipart/form-data": { schema: MailsModel.Update.MultipartSchema }
            }
        },
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail updated successfully", MailsModel.Update.Response),
            APIResponseSpec.notFound("Mail with specified UID not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;
        // @ts-ignore
        const mailData = c.get("mailData") as MailRessource.IMail;
        // @ts-ignore
        const source = c.get("mailSource") as Buffer;

        const payload = await readMailPayload(c, MailsModel.Update.Body);
        if (!payload.ok) return APIResponse.badRequest(c, payload.error);

        const { body, files } = payload;

        const removeIds = new Set(body.removeAttachments ?? []);
        const unknownIds = [...removeIds].filter(id => !mailData.attachments.some(attachment => attachment.id === id));
        if (unknownIds.length > 0) {
            return APIResponse.badRequest(c, `Unknown attachment id(s): ${unknownIds.join(', ')}`);
        }

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            let newUid: number | undefined;
            let attachments: MailRessource.MailAttachment[] | undefined;

            // Content fields and attachment changes both require rebuilding the mail.
            const hasContentUpdate = body.from !== undefined || body.to !== undefined ||
                body.cc !== undefined || body.bcc !== undefined || body.subject !== undefined ||
                body.body !== undefined || body.replyTo !== undefined || body.inReplyTo !== undefined ||
                body.references !== undefined || body.priority !== undefined ||
                files.length > 0 || removeIds.size > 0;

            // Handle content update (replaces the mail)
            if (hasContentUpdate) {
                const keptAttachmentSize = mailData.attachments
                    .filter(attachment => !removeIds.has(attachment.id))
                    .reduce((total, attachment) => total + attachment.size, 0);
                if (keptAttachmentSize + totalFileSize(files) > maxAttachmentSize()) {
                    return APIResponse.badRequest(c, attachmentLimitError());
                }

                // Attachment ids are indices into this same parse, so filtering by
                // index drops exactly the requested ones. Kept attachments keep their
                // order and new files are appended, so the remaining ids stay stable.
                const keptAttachments = (await MailParser.getAttachmentContents(source))
                    .filter((_, id) => !removeIds.has(id))
                    .map(attachment => ({
                        filename: attachment.filename,
                        content: Buffer.from(
                            attachment.content.buffer,
                            attachment.content.byteOffset,
                            attachment.content.byteLength
                        ),
                        contentType: attachment.contentType,
                        cid: attachment.contentId,
                        contentDisposition: attachment.contentDisposition === 'inline'
                            ? 'inline'
                            : attachment.contentDisposition === 'attachment'
                                ? 'attachment'
                                : undefined
                    } satisfies ComposerAttachment));

                const message = await buildDraftMessage({
                    from: body.from ? formatEmailAddress(body.from) : (mailData.from ? formatEmailAddress(mailData.from) : undefined),
                    to: body.to?.map(formatEmailAddress) ?? mailData.to?.map(formatEmailAddress),
                    cc: body.cc?.map(formatEmailAddress) ?? mailData.cc?.map(formatEmailAddress),
                    bcc: body.bcc?.map(formatEmailAddress) ?? mailData.bcc?.map(formatEmailAddress),
                    replyTo: body.replyTo?.map(formatEmailAddress) ?? mailData.replyTo?.map(formatEmailAddress),
                    inReplyTo: body.inReplyTo ?? mailData.inReplyTo,
                    references: body.references ?? mailData.references,
                    subject: body.subject ?? mailData.subject,
                    text: body.body ? body.body.text : mailData.body?.text,
                    html: body.body ? body.body.html : mailData.body?.html,
                    priority: body.priority ?? mailData.priority,
                    attachments: [...keptAttachments, ...await toComposerAttachments(files)]
                });

                // Parse the built message before it is appended: a failure here
                // would otherwise leave the replacement in place next to the
                // original, and every retry would add another copy.
                attachments = await MailParser.getAttachmentMetadata(message);

                // Create new mail with updated content and flags. A partial flag
                // update is merged onto the mail's existing flags so unmentioned
                // flags (e.g. \\Draft) survive the rebuild. `\\Recent` is server-
                // managed, and `\\Deleted` is never re-asserted: the replacement
                // would be expunged along with the version it replaces.
                const newFlags = MailParser.getRawFlags({
                    ...mailData.flags, ...body.flags, recent: false, deleted: false
                });
                const createdUid = await imap.createMail(mailbox.path, message, newFlags);
                // Without a UID for the replacement the client could not address the
                // draft any more, so the original has to stay: an unreferenced copy
                // in the mailbox is recoverable, the deleted original is not.
                if (createdUid === null) throw new Error("Could not determine the UID of the replacement mail");
                newUid = createdUid;

                // The new mail replaces the old version, so remove it. Servers
                // without UIDPLUS can't expunge a single UID, so they fall back
                // to the Trash folder instead of expunging the whole mailbox.
                const trashPath = imap.supportsUidExpunge()
                    ? null
                    : await SpecialUseHandler.resolveTrashPath(mailAccount.id, imap);
                await imap.deleteReplacedMails(mailbox.path, [mailData.uid], trashPath);
            } else if (body.flags) {
                // Flag-only updates stay on the original IMAP message. Rebuilding the
                // MIME message here would unnecessarily replace its UID and risk loss.
                const { toAdd, toRemove } = MailParser.getFlagChanges(body.flags);
                if (toAdd.length > 0) await imap.addFlags(mailbox.path, [mailData.uid], toAdd);
                if (toRemove.length > 0) await imap.removeFlags(mailbox.path, [mailData.uid], toRemove);
            }

            return APIResponse.success(c, "Mail updated successfully", { success: true, newUid, attachments } satisfies MailsModel.Update.Response);
        } catch (e) {
            Logger.error("Failed to update mail", e);
            return APIResponse.serverError(c, "Failed to update mail");
        }
    }
);

router.post('/:mailUID/send',

    APIRouteSpec.authenticated({
        summary: "Send Mail",
        description: "Send an existing mail (e.g., a draft) via SMTP. With `moveToSent` (the default) the mail is then filed in the account's Sent folder as a read, non-draft message; `savedToSent` reports whether that worked.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail sent successfully", MailsModel.Send.Response),
            APIResponseSpec.notFound("Mail with specified UID not found"),
            APIResponseSpec.badRequest("Mail must include a sender and at least one recipient")
        )
    }),

    validator('json', MailsModel.Send.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;
        // @ts-ignore
        const mailData = c.get("mailData") as MailRessource.IMail;
        // @ts-ignore
        const source = c.get("mailSource") as Buffer;
        const body = c.req.valid('json');

        const smtp = SMTPAccount.fromSettings(mailAccount);
        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();

            // The middleware fetched metadata and MIME source in one IMAP snapshot,
            // keeping the SMTP envelope bound to the exact bytes being delivered.
            const result = await smtp.sendRaw(source, mailData);
            if (!result) return APIResponse.badRequest(c, "Mail must include a sender and at least one recipient");

            // The mail is out, so filing the original is best effort: a folder
            // problem must not turn a delivered mail into an error that invites a
            // resend.
            let savedToSent = false;
            try {
                if (body.moveToSent) {
                    savedToSent = await fileSentMail(imap, mailAccount.id, mailbox.path, mailData.uid);
                } else if (body.deleteOriginal) {
                    // Only delete if not moving to Sent
                    const trashPath = await SpecialUseHandler.resolveTrashPath(mailAccount.id, imap);
                    await imap.moveToTrash(mailbox.path, [mailData.uid], trashPath);
                }
            } catch (e) {
                Logger.error(`Sent mail with UID ${mailData.uid}, but failed to file it afterwards`, e);
            }

            return APIResponse.success(c, "Mail sent successfully", {
                // The raw source goes out with the draft's own Message-ID. For raw
                // input nodemailer's `result.messageId` is generated and never sent.
                messageId: mailData.messageId,
                savedToSent
            } satisfies MailsModel.Send.Response);
        } catch (e) {
            if (SMTPAccount.isMessageTooLargeError(e)) {
                return APIResponse.badRequest(c, "The mail server rejected the message because it is too large");
            }
            Logger.error("Failed to send mail", e);
            return APIResponse.serverError(c, "Failed to send mail");
        }
    }
);

router.post('/:mailUID/move',

    APIRouteSpec.authenticated({
        summary: "Move Mail",
        description: "Move a mail to another mailbox/folder.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],
        
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail moved successfully", MailsModel.Move.Response),
            APIResponseSpec.notFound("Mail with specified UID not found")
        )
    }),

    validator('json', MailsModel.Move.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;
        // @ts-ignore
        const mailData = c.get("mailData") as MailRessource.IMail;
        const body = c.req.valid('json');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            await imap.moveToMailbox(mailbox.path, [mailData.uid], body.targetMailbox);

            return APIResponse.success(c, "Mail moved successfully", {} satisfies MailsModel.Move.Response);
        } catch (e) {
            Logger.error("Failed to move mail", e);
            return APIResponse.serverError(c, "Failed to move mail");
        }
    }
);

router.post('/:mailUID/flags',

    APIRouteSpec.authenticated({
        summary: "Set Mail Flags",
        description: "Set message flags such as the seen/read state. Only the flags present in the body are changed (`true` sets the flag, `false` clears it); flags are applied in place without altering the mail's UID.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail flags updated successfully", MailsModel.SetFlags.Response),
            APIResponseSpec.notFound("Mail with specified UID not found")
        )
    }),

    validator('json', MailsModel.SetFlags.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;
        // @ts-ignore
        const mailData = c.get("mailData") as MailRessource.IMail;
        const body = c.req.valid('json');

        const { toAdd, toRemove } = MailParser.getFlagChanges(body);

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            if (toAdd.length > 0) await imap.addFlags(mailbox.path, [mailData.uid], toAdd);
            if (toRemove.length > 0) await imap.removeFlags(mailbox.path, [mailData.uid], toRemove);

            const flags = { ...(mailData.flags ?? {}), ...body };

            return APIResponse.success(c, "Mail flags updated successfully", { success: true, flags } satisfies MailsModel.SetFlags.Response);
        } catch (e) {
            Logger.error("Failed to update mail flags", e);
            return APIResponse.serverError(c, "Failed to update mail flags");
        }
    }
);

router.delete('/:mailUID',

    APIRouteSpec.authenticated({
        summary: "Delete Mail",
        description: "Delete a mail by moving it to trash, or permanently delete it.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail deleted successfully", MailsModel.Delete.Response),
            APIResponseSpec.notFound("Mail with specified UID not found")
        )
    }),

    validator('query', MailsModel.Delete.Query),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;
        // @ts-ignore
        const mailData = c.get("mailData") as MailRessource.IMail;
        const query = c.req.valid('query');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            
            if (query.permanent) {
                await imap.permanentlyDelete(mailbox.path, [mailData.uid]);
            } else {
                // Move to trash
                const trashPath = await SpecialUseHandler.resolveTrashPath(mailAccount.id, imap);
                await imap.moveToTrash(mailbox.path, [mailData.uid], trashPath);
            }

            return APIResponse.success(c, "Mail deleted successfully", { success: true } satisfies MailsModel.Delete.Response);
        } catch (e) {
            Logger.error("Failed to delete mail", e);
            return APIResponse.serverError(c, "Failed to delete mail");
        }
    }
);

router.route('/:mailUID/attachments', attachmentsRouter);
