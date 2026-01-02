import { DB } from "../../../../db";
import { z } from "zod";
import { createInsertSchema, createUpdateSchema, createSelectSchema } from "drizzle-zod";

export namespace MailIdentitiesModel {

    export const BASE = createSelectSchema(DB.Schema.mailIdentities, {
        id: z.int().positive(),
        created_at: z.int().positive(),

        email_address: z.email(),
        display_name: z.string().min(1).max(255),
    }).omit({
        mail_account_id: true
    });

    export type Base = z.infer<typeof BASE>;

    
    export const Params = z.object({
        mailIdentityID: z.coerce.number().positive(),
    });

    export type Params = z.infer<typeof Params>;

}

export namespace MailIdentitiesModel.GetByID {

    export const Response = MailIdentitiesModel.BASE;

    export type Response = z.infer<typeof Response>;

}

export namespace MailIdentitiesModel.GetAll {

    export const Response = z.array(MailIdentitiesModel.BASE);

    export type Response = z.infer<typeof Response>;

}

export namespace MailIdentitiesModel.CreateMailIdentity {

    export const Body = MailIdentitiesModel.BASE.omit({
        id: true,
        created_at: true,
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        id: z.int().positive(),
    });

    export type Response = z.infer<typeof Response>;

}

export namespace MailIdentitiesModel.UpdateMailIdentity {

    export const Body = MailIdentitiesModel.BASE.partial().omit({
        id: true,
        created_at: true,
    });

    export type Body = z.infer<typeof Body>;

}
