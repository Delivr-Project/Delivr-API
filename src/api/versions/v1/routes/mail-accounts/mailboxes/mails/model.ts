import { z } from "zod";
import { MailRessource } from "../../../../../../../utils/mails/ressources/mail";
import type { Utils } from "../../../../../../../utils";
import { ApiHelperModels } from "../../../../../../utils/shared-models/api-helper-models";

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

export namespace MailsModel.Create {

    export const Body = MailsModel.Mail.omit({
        uid: true,
        rawHeaders: true,
        rawFlags: true,
        attachments: true,
        date: true
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        uid: z.number()
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.Move {

    export const Body = z.object({
        targetMailbox: z.string().describe("The path of the target mailbox to move the mail to")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        newUid: z.number().optional().describe("The new UID of the mail in the target mailbox, if available")
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.Update {

    export const Body = MailsModel.Create.Body.partial();

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        success: z.boolean(),
        newUid: z.number().optional().describe("New UID if the mail was replaced (for content updates)")
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.Send {

    export const Body = z.object({
        moveToSent: z.boolean().default(true).describe("Whether to move the original mail to Sent folder after sending"),
        deleteOriginal: z.boolean().default(false).describe("Whether to delete the original mail after sending (only if moveToSent is false)")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        messageId: z.string().optional().describe("The Message-ID of the sent mail")
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.Delete {

    export const Query = z.object({
        permanent: z.coerce.boolean().default(false).describe("If true, permanently delete the mail. Otherwise, move to Trash.")
    });

    export type Query = z.infer<typeof Query>;

    export const Response = z.object({
        success: z.boolean()
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.BulkMove {

    export const Body = z.object({
        uids: z.array(z.number()).min(1).describe("UIDs of the mails to move"),
        targetMailbox: z.string().describe("The path of the target mailbox to move the mails to")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        success: z.boolean()
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.BulkCopy {

    export const Body = z.object({
        uids: z.array(z.number()).min(1).describe("UIDs of the mails to copy"),
        targetMailbox: z.string().describe("The path of the target mailbox to copy the mails to")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        success: z.boolean()
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.BulkDelete {

    export const Body = z.object({
        uids: z.array(z.number()).min(1).describe("UIDs of the mails to delete"),
        permanent: z.boolean().default(false).describe("If true, permanently delete the mails. Otherwise, move to Trash.")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        success: z.boolean()
    });

    export type Response = z.infer<typeof Response>;
}
