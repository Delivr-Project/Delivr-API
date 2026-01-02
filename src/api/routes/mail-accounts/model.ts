import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../db";
import { z } from "zod";
import { InetModels } from "../../utils/shared-models/inetModels";


export namespace MailAccountsModel {

    export const BASE = createSelectSchema(DB.Schema.mailAccounts, {
        id: z.int().positive(),
        created_at: z.int().positive(),

        owner_user_id: z.int().positive(),

        display_name: z.string().min(1, "Display name must not be empty").max(255, "Display name must be at most 255 characters"),

        smtp_host: InetModels.Host,
        smtp_port: InetModels.PORT,
        smtp_encryption: InetModels.Mail.Encryption,
        smtp_username: z.string().min(1, "SMTP username must not be empty").max(255, "SMTP username must be at most 255 characters"),
        smtp_password: z.string().min(1, "SMTP password must not be empty").max(1023, "SMTP password must be at most 1023 characters"),

        imap_host: InetModels.Host,
        imap_port: InetModels.PORT,
        imap_encryption: InetModels.Mail.Encryption,
        imap_username: z.string().min(1, "IMAP username must not be empty").max(255, "IMAP username must be at most 255 characters"),
        imap_password: z.string().min(1, "IMAP password must not be empty").max(1023, "IMAP password must be at most 1023 characters"),
        
        is_default: z.boolean(),
    });

    export type BASE = z.infer<typeof BASE>;

    export const MailAccountIDParams = z.object({
        mailAccountID: z.coerce.number().positive()
    });
    export type MailAccountIDParams = z.infer<typeof MailAccountIDParams>;
}

export namespace MailAccountsModel.GetMailAccountByID {

    export const Response = MailAccountsModel.BASE.omit({
        imap_password: true,
        smtp_password: true,
        owner_user_id: true
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailAccountsModel.GetAllMailAccounts {

    export const Response = z.array(MailAccountsModel.GetMailAccountByID.Response);

    export type Response = z.infer<typeof Response>;

}

export namespace MailAccountsModel.CreateMailAccount {

    export const Body = MailAccountsModel.BASE.omit({
        id: true,
        created_at: true,
        owner_user_id: true
    }).extend({
        is_default: z.boolean().optional()
    });
    
    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        id: z.number()
    });
    export type Response = z.infer<typeof Response>;
}

export namespace MailAccountsModel.UpdateMailAccountInfo {

    export const Body = MailAccountsModel.CreateMailAccount.Body.partial().omit({
        smtp_host: true,
        smtp_port: true,
        smtp_username: true,
        smtp_password: true,
        smtp_encryption: true,
        imap_host: true,
        imap_port: true,
        imap_username: true,
        imap_password: true,
        imap_encryption: true
    });

    export type Body = z.infer<typeof Body>;
}

export namespace MailAccountsModel.UpdateMailAccountCredentials {

    export const Body = MailAccountsModel.CreateMailAccount.Body.pick({
        smtp_host: true,
        smtp_port: true,
        smtp_username: true,
        smtp_password: true,
        smtp_encryption: true,

        imap_host: true,
        imap_port: true,
        imap_username: true,
        imap_password: true,
        imap_encryption: true
    });

    export type Body = z.infer<typeof Body>;
}