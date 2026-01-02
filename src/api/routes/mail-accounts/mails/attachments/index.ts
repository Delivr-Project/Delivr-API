import { Hono } from "hono";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { z } from "zod";
import { IMAPAccount } from "../../../../utils/mails/backends/imap";
import { MailAccountsModel } from "../../model";
import { validator } from "hono-openapi";

export const router = new Hono();

router.get('/',
    APIRouteSpec.authenticated({
        summary: "List Attachments",
        description: "List attachments of a specific mail.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Attachments retrieved successfully", z.array(z.object({
                filename: z.string().optional(),
                contentType: z.string(),
                size: z.number(),
                contentId: z.string().optional(),
                id: z.number()
            })))
        )
    }),
    validator('query', z.object({ mailbox: z.string().default("INBOX") })),
    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const mailID = parseInt(c.req.param('mailID'));
        const query = c.req.valid('query');

        if (isNaN(mailID)) {
            return APIResponse.error(c, "Invalid mail ID", 400);
        }

        const imap = IMAPAccount.fromSettings(mailAccount);
        
        try {
            await imap.connect();
            const mail = await imap.getMail(query.mailbox, mailID);
            
            if (!mail) {
                return APIResponse.notFound(c, "Mail not found");
            }

            const attachments = mail.attachments.map((att, index) => ({
                filename: att.filename,
                contentType: att.contentType,
                size: att.size,
                contentId: att.contentId,
                id: index
            }));

            return APIResponse.success(c, attachments);
        } catch (e) {
            console.error(e);
            return APIResponse.error(c, "Failed to fetch attachments", 500);
        } finally {
            if (imap.connected) {
                await imap.disconnect();
            }
        }
    }
);

router.get('/:attachmentID/download',
    APIRouteSpec.authenticated({
        summary: "Download Attachment",
        description: "Download a specific attachment.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
    }),
    validator('query', z.object({ mailbox: z.string().default("INBOX") })),
    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const mailID = parseInt(c.req.param('mailID'));
        const attachmentID = parseInt(c.req.param('attachmentID'));
        const query = c.req.valid('query');

        if (isNaN(mailID) || isNaN(attachmentID)) {
            return APIResponse.error(c, "Invalid ID", 400);
        }

        const imap = IMAPAccount.fromSettings(mailAccount);
        
        try {
            await imap.connect();
            const mail = await imap.getMail(query.mailbox, mailID);
            
            if (!mail) {
                return APIResponse.notFound(c, "Mail not found");
            }

            const attachment = mail.attachments[attachmentID];
            if (!attachment) {
                return APIResponse.notFound(c, "Attachment not found");
            }

            c.header('Content-Type', attachment.contentType);
            c.header('Content-Disposition', `attachment; filename="${attachment.filename || 'attachment'}"`);
            return c.body(attachment.content);
        } catch (e) {
            console.error(e);
            return APIResponse.error(c, "Failed to download attachment", 500);
        } finally {
            if (imap.connected) {
                await imap.disconnect();
            }
        }
    }
);
