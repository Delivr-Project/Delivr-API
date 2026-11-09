import { DB } from "../../../../../../db";
import { z } from "zod";
import { createInsertSchema, createUpdateSchema, createSelectSchema } from "drizzle-zod";

export namespace MailIdentitiesModel {

    /**
     * HTML signature as produced by the compose editor. Generous enough for a
     * formatted footer with links, but not for embedded image data — the editor
     * turns dropped files into attachments rather than inlining them.
     */
    export const SIGNATURE = z.string().max(16384, "Signature must be at most 16384 characters").nullable();

    /**
     * Label that is only shown inside Delivr, to tell apart identities with the
     * same display name (e.g. "Work" / "Newsletter"). Never sent to recipients.
     */
    export const DESCRIPTION = z.string().min(1, "Description must not be empty").max(255, "Description must be at most 255 characters").nullable();

    export const BASE = createSelectSchema(DB.Tables.mailIdentities, {
        id: z.int().positive(),
        created_at: z.int().positive(),

        email_address: z.email(),
        display_name: z.string().min(1).max(255),

        description: DESCRIPTION,

        signature: SIGNATURE
    });

    export type Base = z.infer<typeof BASE>;

    
    export const Params = z.object({
        mailIdentityID: z.coerce.number().positive(),
    });

    export type Params = z.infer<typeof Params>;

}

export namespace MailIdentitiesModel.GetByID {

    export const Response = MailIdentitiesModel.BASE.omit({
        mail_account_id: true
    });

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
        mail_account_id: true
    }).extend({
        // An identity without a description or signature simply omits it.
        description: MailIdentitiesModel.DESCRIPTION.optional(),
        signature: MailIdentitiesModel.SIGNATURE.optional()
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        id: z.int().positive(),
    });

    export type Response = z.infer<typeof Response>;

}

export namespace MailIdentitiesModel.UpdateMailIdentity {

    export const Body = MailIdentitiesModel.CreateMailIdentity.Body.partial();

    export type Body = z.infer<typeof Body>;

}
