import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../db";

export namespace AuthModel.Login {

    export const Body = z.object({
        username: z.string(),
        password: z.string()
    });
    export type Body = z.infer<typeof Body>;

    export const Response = createSelectSchema(DB.Schema.sessions).omit({
        id: true,
        hashed_token: true
    }).extend({
        token: z.string()
    });
    export type Response = z.infer<typeof Response>;
}

export namespace AuthModel.Session {

    export const Response = createSelectSchema(DB.Schema.sessions).omit({
        id: true,
        hashed_token: true
    });
    export type Response = z.infer<typeof Response>;

}