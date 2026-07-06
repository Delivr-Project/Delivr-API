import { Hono } from "hono";
import { MailsModel } from "./model";
import { APIResponse } from "../../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../../docs";
import { z } from "zod";
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
import { MailParser } from "../../../../../../../utils/mails/parser";



function formatEmailAddress(addr: { name?: string; address: string }): string {
    return addr.name ? `"${addr.name}" <${addr.address}>` : addr.address;
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

    APIRouteSpec.authenticated({
        summary: "Create Mail",
        description: "Create a new mail in the current mailbox (e.g., a draft).",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail created successfully", MailsModel.Create.Response),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    validator('json', MailsModel.Create.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;

        const body = c.req.valid('json');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            const composer = new MailComposer({
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
                priority: body.priority
            });

            const message = await composer.compile().build();

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
            const mail = await imap.getMail(mailbox.path, mailUID);

            if (!mail) {
                return APIResponse.notFound(c, "Mail with specified UID not found");
            }

            // @ts-ignore
            c.set("mailData", mail);

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
        const body = c.req.valid('json');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            let newUid: number | undefined;

            // Check if any content fields are being updated
            const hasContentUpdate = body.from !== undefined || body.to !== undefined || 
                body.cc !== undefined || body.bcc !== undefined || body.subject !== undefined || 
                body.body !== undefined || body.replyTo !== undefined || body.inReplyTo !== undefined ||
                body.references !== undefined || body.priority !== undefined ||
                body.flags !== undefined;

            // Handle content update (replaces the mail)
            if (hasContentUpdate) {
                const composer = new MailComposer({
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
                    priority: body.priority ?? mailData.priority
                });

                const message = await composer.compile().build();

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
            APIResponseSpec.notFound("Mail with specified UID not found")
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
        const body = c.req.valid('json');

        const smtp = SMTPAccount.fromSettings(mailAccount);
        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            // Send the mail via SMTP
            const result = await smtp.sendMail(mailData);

            await imap.connect();

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

