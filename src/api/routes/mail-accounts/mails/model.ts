import { z } from "zod";
import { MailRessource } from "../../../../utils/mails/ressources/mail";
import type { Utils } from "../../../../utils";

export namespace MailsModel {

    export const EmailAddress = z.object({
        name: z.string().optional(),
        address: z.string()
    });

    export type EmailAddress = Utils.SameType<z.infer<typeof EmailAddress>, MailRessource.EmailAddress>;

    export const MailAttachment = z.object({
        filename: z.string().optional(),
        contentType: z.string(),
        size: z.number(),
        contentId: z.string().optional(),
        contentDisposition: z.string().optional()
    });

    export type MailAttachment = Utils.SameType<z.infer<typeof MailAttachment>, MailRessource.MailAttachment>;

    export const MailBody = z.object({
        text: z.string().optional(),
        html: z.string().optional()
    });

    export type MailBody = Utils.SameType<z.infer<typeof MailBody>, MailRessource.MailBody>;

    export const Mail = z.object({
        uid: z.number(),
        rawHeaders: z.record(z.string(), z.string()),
        from: EmailAddress.optional(),
        to: z.array(EmailAddress).optional(),
        cc: z.array(EmailAddress).optional(),
        bcc: z.array(EmailAddress).optional(),
        subject: z.string().optional(),
        inReplyTo: z.string().optional(),
        replyTo: EmailAddress.optional(),
        references: z.union([z.string(), z.array(z.string())]).optional(),
        date: z.number().optional(),
        attachments: z.array(MailAttachment),
        body: MailBody.optional()
    });

    export type Mail = Utils.SameType<z.infer<typeof Mail>, MailRessource.IMail>;


    export const Param = z.object({
        mailUID: z.coerce.number()
    });
    
    export type Param = z.infer<typeof Param>;
}

export namespace MailsModel.GetByUID {
    
    export const Query = z.object({
        mailbox: z.string().default("INBOX")
    });

    export const Response = MailsModel.Mail;

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.GetAll {

    export const Query = z.object({
        mailbox: z.string().default("INBOX"),
        limit: z.coerce.number().default(50)
    });

    export const Response = z.array(MailsModel.Mail);

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.CreateDraft {

    export const Body = MailsModel.Mail.omit({
        uid: true,
        rawHeaders: true,
        attachments: true,
        date: true
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        uid: z.number()
    });
}

export namespace MailsModel.Move {

    export const Body = z.object({
        targetMailbox: z.string()
    });

    export type Body = z.infer<typeof Body>;
}

export namespace MailsModel.Update {

    export const Body = MailsModel.CreateDraft.Body.partial().omit({

    })

    export type Body = z.infer<typeof Body>;
}


