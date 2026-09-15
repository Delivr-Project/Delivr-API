import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MailsModel } from "./model";
import { APIResponse } from "../../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../../docs";
import { resolver, validator } from "hono-openapi";
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
import { MailParser } from "../../../../../../../utils/mails/parser";
import { ConfigHandler } from "../../../../../../../utils/config";
import type { OpenAPIV3_1 } from "openapi-types";



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
// This is deliberately independent from the attachment limit. It is a final
// memory-safety guard for multipart parsing, not part of attachment validation.
const MULTIPART_NON_ATTACHMENT_ALLOWANCE_BYTES = 16 * 1024 * 1024;

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

/**
 * Bound multipart request bodies while they are read. Attachment sizes are
 * validated separately after parsing, so large (but valid) mail JSON does not
 * consume the configured attachment allowance.
 */
const enforceMultipartBodyLimit: MiddlewareHandler = async (c, next) => {
    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) return next();

    return bodyLimit({
        maxSize: maxAttachmentSize() + MULTIPART_NON_ATTACHMENT_ALLOWANCE_BYTES,
        onError: context => APIResponse.badRequest(
            context,
            `Multipart request exceeds the maximum total size of ${(maxAttachmentSize() + MULTIPART_NON_ATTACHMENT_ALLOWANCE_BYTES) / (1024 * 1024)} MB (mail JSON, attachments and framing combined)`
        )
    })(c, next);
};

/**
 * Read the create-mail payload from either a JSON body or a `multipart/form-data`
 * body carrying attachments.
 *
 * In the multipart case the mail itself arrives as a JSON string in the `mail`
 * field and each file as an `attachments` entry. Files are read into memory only
 * for as long as it takes to compose the message — nothing is written to disk.
 *
 * @returns The validated body plus attachments, or an error message to return as a 400
 */
async function readCreatePayload(c: Context): Promise<
    { ok: true; body: MailsModel.Create.Body; attachments: ComposerAttachment[] } |
    { ok: false; error: string }
> {
    const contentType = c.req.header('content-type') ?? '';
    const isMultipart = contentType.toLowerCase().includes('multipart/form-data');

    let rawBody: unknown;
    const attachments: ComposerAttachment[] = [];

    if (isMultipart) {
        let form: FormData;
        try {
            form = await c.req.formData();
        } catch (error) {
            // Hono's body-limit middleware needs to observe this sentinel error
            // so it can replace the response without buffering the remaining body.
            if (error instanceof Error && error.name === 'BodyLimitError') throw error;
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
        const files = attachmentEntries as File[];

        const limit = maxAttachmentSize();
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        if (totalSize > limit) {
            return {
                ok: false,
                error: attachmentLimitError()
            };
        }

        for (const file of files) {
            attachments.push({
                filename: file.name || 'attachment',
                content: Buffer.from(await file.arrayBuffer()),
                contentType: file.type || undefined
            });
        }
    } else {
        try {
            rawBody = await c.req.json();
        } catch {
            return { ok: false, error: "Malformed JSON body" };
        }
    }

    const parsed = MailsModel.Create.Body.safeParse(rawBody);
    if (!parsed.success) {
        return { ok: false, error: "Bad Request: Syntax or validation error in request" };
    }

    return { ok: true, body: parsed.data, attachments };
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

    enforceMultipartBodyLimit,

    APIRouteSpec.authenticated({
        summary: "Create Mail",
        description: "Create a new mail in the current mailbox (e.g., a draft). Supports JSON bodies and multipart bodies with attachments. Multipart requests have a total size limit of DLA_MAX_ATTACHMENT_SIZE_MB + 16 MB, including mail JSON, attachments and framing; attachments separately must fit DLA_MAX_ATTACHMENT_SIZE_MB.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],
        requestBody: {
            required: true,
            content: {
                "application/json": { schema: resolver(MailsModel.Create.Body).toJSONSchema() as OpenAPIV3_1.SchemaObject },
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

        const payload = await readCreatePayload(c);
        if (!payload.ok) return APIResponse.badRequest(c, payload.error);

        const { body, attachments } = payload;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            const composerOptions = {
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
                attachments,
                keepBcc: true
            };
            const composer = new MailComposer(composerOptions);

            const compiledMail = composer.compile();
            // Drafts must retain Bcc recipients so the later send request can
            // build the SMTP envelope. SMTPAccount.sendRaw removes this header
            // from the transmitted source to keep recipients private. Assigning
            // it to the node also supports MailComposer versions that do not
            // forward the option to MimeNode.
            Object.assign(compiledMail, { keepBcc: true });
            const message = await compiledMail.build();

            await imap.connect();
            await imap.createMail(mailbox.path, message, MailParser.getRawFlags(body.flags || {}));

            // Get the latest mail to find its UID
            const mails = await imap.getMails(mailbox.path, { order: 'newest', limit: 1 });
            const latestMail = mails[0];
            const createdUid = latestMail ? latestMail.uid : 0;

            return APIResponse.success(c, "Mail created successfully", { uid: createdUid } satisfies MailsModel.Create.Response);
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
    
    APIRouteSpec.authenticated({
        summary: "Update Mail",
        description: "Update mail content (for drafts). The mail is replaced with a new one containing the updated content.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail updated successfully", MailsModel.Update.Response),
            APIResponseSpec.notFound("Mail with specified UID not found")
        )
    }),

    validator('json', MailsModel.Update.Body),
    
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

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            let newUid: number | undefined;

            // Check if any content fields are being updated
            const hasContentUpdate = body.from !== undefined || body.to !== undefined || 
                body.cc !== undefined || body.bcc !== undefined || body.subject !== undefined || 
                body.body !== undefined || body.replyTo !== undefined || body.inReplyTo !== undefined ||
                body.references !== undefined || body.priority !== undefined;

            // Handle content update (replaces the mail)
            if (hasContentUpdate) {
                const existingAttachments = (await MailParser.getAttachmentContents(source)).map(attachment => ({
                    filename: attachment.filename,
                    content: Buffer.from(attachment.content),
                    contentType: attachment.contentType,
                    cid: attachment.contentId,
                    contentDisposition: attachment.contentDisposition === 'inline'
                        ? 'inline'
                        : attachment.contentDisposition === 'attachment'
                            ? 'attachment'
                            : undefined
                } satisfies ComposerAttachment));

                const composerOptions = {
                    from: body.from ? formatEmailAddress(body.from) : (mailData.from ? formatEmailAddress(mailData.from) : undefined),
                    to: body.to?.map(formatEmailAddress) ?? mailData.to?.map(formatEmailAddress),
                    cc: body.cc?.map(formatEmailAddress) ?? mailData.cc?.map(formatEmailAddress),
                    bcc: body.bcc?.map(formatEmailAddress) ?? mailData.bcc?.map(formatEmailAddress),
                    replyTo: body.replyTo?.map(formatEmailAddress) ?? mailData.replyTo?.map(formatEmailAddress),
                    inReplyTo: body.inReplyTo ?? mailData.inReplyTo,
                    references: body.references ?? mailData.references,
                    subject: body.subject ?? mailData.subject,
                    text: body.body?.text ?? mailData.body?.text,
                    html: body.body?.html ?? mailData.body?.html,
                    priority: body.priority ?? mailData.priority,
                    attachments: existingAttachments,
                    keepBcc: true
                };
                const composer = new MailComposer(composerOptions);

                const compiledMail = composer.compile();
                Object.assign(compiledMail, { keepBcc: true });
                const message = await compiledMail.build();

                // Create new mail with updated content and flags
                const newFlags = body.flags ? MailParser.getRawFlags(body.flags) : mailData.rawFlags;
                await imap.createMail(mailbox.path, message, newFlags);
                
                // Get the newly created mail's UID
                const mails = await imap.getMails(mailbox.path, { order: 'newest', limit: 1 });
                const latestMail = mails[0];
                newUid = latestMail ? latestMail.uid : undefined;

                // Delete the old mail
                const trashPath = await SpecialUseHandler.resolveTrashPath(mailAccount.id, imap);
                await imap.moveToTrash(mailbox.path, [mailData.uid], trashPath);
            } else if (body.flags) {
                // Flag-only updates stay on the original IMAP message. Rebuilding the
                // MIME message here would unnecessarily replace its UID and risk loss.
                const flagMap: Record<string, string> = {
                    seen: '\\Seen',
                    answered: '\\Answered',
                    flagged: '\\Flagged',
                    draft: '\\Draft',
                    deleted: '\\Deleted'
                };
                const flagsToAdd: string[] = [];
                const flagsToRemove: string[] = [];
                for (const [key, imapFlag] of Object.entries(flagMap)) {
                    const value = body.flags[key as keyof typeof body.flags];
                    if (value === true) flagsToAdd.push(imapFlag);
                    else if (value === false) flagsToRemove.push(imapFlag);
                }

                if (flagsToAdd.length > 0) await imap.addFlags(mailbox.path, [mailData.uid], flagsToAdd);
                if (flagsToRemove.length > 0) await imap.removeFlags(mailbox.path, [mailData.uid], flagsToRemove);
            }

            return APIResponse.success(c, "Mail updated successfully", { success: true, newUid } satisfies MailsModel.Update.Response);
        } catch (e) {
            Logger.error("Failed to update mail", e);
            return APIResponse.serverError(c, "Failed to update mail");
        }
    }
);

router.post('/:mailUID/send',

    APIRouteSpec.authenticated({
        summary: "Send Mail",
        description: "Send an existing mail (e.g., a draft) via SMTP.",
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

            // Move original mail to Sent folder (default behavior)
            if (body.moveToSent) {
                await imap.moveToMailbox(mailbox.path, [mailData.uid], 'Sent');
            } else if (body.deleteOriginal) {
                // Only delete if not moving to Sent
                const trashPath = await SpecialUseHandler.resolveTrashPath(mailAccount.id, imap);
                await imap.moveToTrash(mailbox.path, [mailData.uid], trashPath);
            }

            return APIResponse.success(c, "Mail sent successfully", { 
                messageId: result?.messageId 
            } satisfies MailsModel.Send.Response);
        } catch (e) {
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

        // Map user-facing flag names to their IMAP system flags. `\Recent` is
        // server-managed and cannot be set by clients, so it is intentionally omitted.
        const FLAG_MAP: Record<string, string> = {
            seen: '\\Seen',
            answered: '\\Answered',
            flagged: '\\Flagged',
            draft: '\\Draft',
            deleted: '\\Deleted'
        };

        const flagsToAdd: string[] = [];
        const flagsToRemove: string[] = [];
        for (const [key, imapFlag] of Object.entries(FLAG_MAP)) {
            const value = body[key as keyof MailsModel.SetFlags.Body];
            if (value === true) flagsToAdd.push(imapFlag);
            else if (value === false) flagsToRemove.push(imapFlag);
        }

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            if (flagsToAdd.length > 0) await imap.addFlags(mailbox.path, [mailData.uid], flagsToAdd);
            if (flagsToRemove.length > 0) await imap.removeFlags(mailbox.path, [mailData.uid], flagsToRemove);

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
