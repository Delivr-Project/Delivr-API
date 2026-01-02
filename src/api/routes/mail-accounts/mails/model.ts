import { z } from "zod";
import { MailRessource } from "../../../../utils/mails/mail";

export namespace MailsModel {

    export const EmailAddress = z.object({
        name: z.string().optional(),
        address: z.string()
    });

    export const MailAttachment = z.object({
        filename: z.string().optional(),
        contentType: z.string(),
        size: z.number(),
        // content: z.any(), // Exclude content from API response to keep it light
        contentId: z.string().optional(),
        contentDisposition: z.string().optional()
    });

    export const MailBody = z.object({
        contentType: z.enum(["text", "html"]),
        content: z.string()
    });

    export const BASE = z.object({
        uid: z.number(),
        rawHeaders: z.record(z.string(), z.string()),
        from: z.array(EmailAddress).optional(),
        to: z.array(EmailAddress).optional(),
        cc: z.array(EmailAddress).optional(),
        bcc: z.array(EmailAddress).optional(),
        subject: z.string().optional(),
        inReplyTo: z.string().optional(),
        references: z.union([z.string(), z.array(z.string())]).optional(),
        date: z.number().optional(),
        attachments: z.array(MailAttachment),
        body: MailBody.optional()
    });

    export type BASE = z.infer<typeof BASE>;
}

export namespace MailsModel.GetByUID {
    
    export const Query = z.object({
        mailbox: z.string().default("INBOX")
    });

    export const Response = MailsModel.BASE;

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.GetAll {

    export const Query = z.object({
        mailbox: z.string().default("INBOX"),
        limit: z.coerce.number().default(50)
    });

    export const Response = z.array(MailsModel.BASE);

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.Create {
    export const Request = z.object({
        from: z.array(MailsModel.EmailAddress).optional(),
        to: z.array(MailsModel.EmailAddress).optional(),
        cc: z.array(MailsModel.EmailAddress).optional(),
        bcc: z.array(MailsModel.EmailAddress).optional(),
        subject: z.string().optional(),
        body: MailsModel.MailBody,
    });
    export type Request = z.infer<typeof Request>;
}

export namespace MailsModel.Move {
    export const Request = z.object({
        targetMailbox: z.string()
    });
    export type Request = z.infer<typeof Request>;
}

export namespace MailsModel.Patch {
    export const Request = z.object({
        flags: z.object({
            add: z.array(z.string()).optional(),
            remove: z.array(z.string()).optional()
        }).optional(),
        from: z.array(MailsModel.EmailAddress).optional(),
        to: z.array(MailsModel.EmailAddress).optional(),
        cc: z.array(MailsModel.EmailAddress).optional(),
        bcc: z.array(MailsModel.EmailAddress).optional(),
        subject: z.string().optional(),
        body: MailsModel.MailBody.optional(),
    });
    export type Request = z.infer<typeof Request>;
}


