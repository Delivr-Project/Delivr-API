import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../db";
import { z } from "zod";
import { InetModels } from "../../utils/shared-models/inetModels";


export namespace MailAccountsModel {

    export const BASE = createSelectSchema(DB.Schema.mailAccounts, {
        id: z.int(),
        owner_user_id: z.int(),
        created_at: z.int(),

        smtp_host: InetModels.Host,
        smtp_port: InetModels.PORT,
        smtp_encryption: InetModels.Mail.Encryption,
        smtp_username: z.string().min(1, "SMTP username must not be empty").max(256, "SMTP username must be at most 256 characters"),
        smtp_password: z.string().min(1, "SMTP password must not be empty").max(1024, "SMTP password must be at most 1024 characters"),

        imap_host: InetModels.Host,
        imap_port: InetModels.PORT,
        imap_encryption: InetModels.Mail.Encryption,
        imap_username: z.string().min(1, "IMAP username must not be empty").max(256, "IMAP username must be at most 256 characters"),
        imap_password: z.string().min(1, "IMAP password must not be empty").max(1024, "IMAP password must be at most 1024 characters")
        
    }).omit({
        owner_user_id: true
    });

    export type BASE = z.infer<typeof BASE>;

    export const MailAccountIDParams = z.object({
        mailAccountID: z.coerce.number().positive()
    });
    export type MailAccountIDParams = z.infer<typeof MailAccountIDParams>;
}

export namespace MailAccountsModel.GetMailAccount {

    export const Response = MailAccountsModel.BASE.omit({
        imap_password: true,
        smtp_password: true
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailAccountsModel.GetAllMailAccounts {

    export const Response = z.array(MailAccountsModel.GetMailAccount.Response);

    export type Response = z.infer<typeof Response>;

}

export namespace MailAccountsModel.CreateMailAccount {

    export const Body = MailAccountsModel.BASE.omit({
        id: true,
        created_at: true
    });
    
    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        id: z.number()
    });
    export type Response = z.infer<typeof Response>;
}

export namespace MailAccountsModel.UpdateMailAccount {
    export const Body = MailAccountsModel.BASE.omit({
        id: true,
        created_at: true,
    }).partial();

    export type Body = z.infer<typeof Body>;
}
