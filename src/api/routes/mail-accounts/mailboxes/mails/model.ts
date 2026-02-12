import { z } from "zod";
import { MailRessource } from "../../../../../utils/mails/ressources/mail";
import type { Utils } from "../../../../../utils";
import { ApiHelperModels } from "../../../../utils/shared-models/api-helper-models";

export namespace MailsModel {

    export const EmailAddress = z.object({
        name: z.string().optional(),
        address: z.string()
    });

    export type EmailAddress = Utils.SameType<z.infer<typeof EmailAddress>, MailRessource.EmailAddress>;

    export const MailFlags = z.object({
        seen: z.boolean().optional(),
        answered: z.boolean().optional(),
        flagged: z.boolean().optional(),
        deleted: z.boolean().optional(),
        draft: z.boolean().optional(),
        recent: z.boolean().optional()
    });

    export type MailFlags = Utils.SameType<z.infer<typeof MailFlags>, MailRessource.MailFlags>;

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

        uid: z.number().min(0),

        rawHeaders: z.record(z.string(), z.string()),
        rawFlags: z.array(z.string()),

        from: EmailAddress.optional(),
        to: z.array(EmailAddress),
        cc: z.array(EmailAddress),
        bcc: z.array(EmailAddress),

        subject: z.string().optional(),
        references: z.union([z.string(), z.array(z.string())]).optional(),
        date: z.number().optional(),
        flags: MailFlags.optional(),

        replyTo: z.array(EmailAddress).optional(),
        messageId: z.string().optional(),
        inReplyTo: z.string().optional(),
        
        priority: z.enum(["normal", "low", "high"]).optional(),

        attachments: z.array(MailAttachment),
        body: MailBody
    });

    export type Mail = Utils.SameType<z.infer<typeof Mail>, MailRessource.IMail>;


    export const Param = z.object({
        mailUID: z.coerce.number()
    });
    
    export type Param = z.infer<typeof Param>;
}

export namespace MailsModel.GetByUID {
    
    export const Response = MailsModel.Mail;

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.GetAll {

    export const Query = ApiHelperModels.ListAll.QueryWithSearch;

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


