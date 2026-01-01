import { createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../db";
import { z } from "zod";
import { UserDataPolicys } from "../../utils/shared-models/accountData";

export namespace AccountModel.GetInfo {

    export const Response = createSelectSchema(DB.Schema.users).omit({
        password_hash: true
    });
    export type Response = z.infer<typeof Response>;

}

export namespace AccountModel.UpdateInfo {

    export const Body = createUpdateSchema(DB.Schema.users, {
        username: UserDataPolicys.Username,
        email: z.email('Invalid email')
    }).omit({
        id: true,
        password_hash: true,
        role: true,
        created_at: true
    }).partial().refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        { message: "At least one field must be provided" }
    );

    export type Body = z.infer<typeof Body>;

}

export namespace AccountModel.UpdatePassword {

    export const Body = z.object({
        current_password: z.string().describe("Current password of the account"),
        new_password: UserDataPolicys.Password
    });

    export type Body = z.infer<typeof Body>;

}