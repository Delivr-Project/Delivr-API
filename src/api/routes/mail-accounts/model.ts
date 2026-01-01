import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../db";
import { z } from "zod";

export namespace MailAccountsModel {

    export namespace Get {
        export const Response = createSelectSchema(DB.Schema.mailAccounts).omit({
            imap_password: true,
            smtp_password: true
        });
        export type Response = z.infer<typeof Response>;
    }

    export namespace Create {
        export const Body = createInsertSchema(DB.Schema.mailAccounts).omit({
            id: true,
            created_at: true
        });
        export type Body = z.infer<typeof Body>;
    }

    export namespace Update {
        export const Body = createUpdateSchema(DB.Schema.mailAccounts).omit({
            id: true,
            created_at: true
        }).partial();
        export type Body = z.infer<typeof Body>;
    }
}
