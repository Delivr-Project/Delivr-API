import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../../db";
import z from "zod";
import { UserDataPolicys } from "../../../utils/shared-models/accountData";

export namespace AdminUsersModel {

    const BaseUser = createSelectSchema(DB.Schema.users);

    export const SafeUser = BaseUser.omit({ password_hash: true });
    export type SafeUser = z.infer<typeof SafeUser>;

    export namespace GetAll {
        export const Query = z.object({
            role: z.enum(["admin", "user"]).optional(),
            search: z.string().min(1).max(64).optional(),
            limit: z.coerce.number().int().min(1).max(100).optional(),
            offset: z.coerce.number().int().min(0).optional(),
        });
        export type Query = z.infer<typeof Query>;

        export const Response = z.array(SafeUser);
        export type Response = z.infer<typeof Response>;
    }

    export namespace Create {
        const InsertSchema = createInsertSchema(DB.Schema.users, {
            username: UserDataPolicys.Username,
            display_name: z.string().min(1).max(64),
            email: z.email(),
        }).omit({
            id: true,
            password_hash: true,
            created_at: true
        });

        export const Body = InsertSchema.extend({
            password: z.string().min(8).max(128),
        });
        export type Body = z.infer<typeof Body>;

        export const Response = SafeUser;
        export type Response = z.infer<typeof Response>;
    }

    export namespace Update {
        export const Body = createUpdateSchema(DB.Schema.users).omit({
            id: true,
            password_hash: true,
            created_at: true
        }).partial().refine(
            (data) => Object.values(data).some((value) => value !== undefined),
            { message: "At least one field must be provided" }
        );
        export type Body = z.infer<typeof Body>;
    }

    export namespace UpdatePassword {
        export const Body = z.object({
            password: UserDataPolicys.Password
        });
        export type Body = z.infer<typeof Body>;
    }

    export namespace UserId {
        export const Params = z.object({
            userId: z.coerce.number().int().positive(),
        });
        export type Params = z.infer<typeof Params>;
    }
}
