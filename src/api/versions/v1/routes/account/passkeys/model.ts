import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../../db";
import { WebAuthnModels } from "../../../../../utils/shared-models/webauthn";

export namespace AccountPasskeysModel {

    export const Name = z.string().trim().min(1).max(100).describe("Name to tell the passkey apart, e.g. the device it lives on");
    export type Name = z.infer<typeof Name>;

    export const Passkey = createSelectSchema(DB.Tables.userPasskeys).omit({
        user_id: true,
        public_key: true,
        counter: true,
        transports: true
    });

    export type Passkey = z.infer<typeof Passkey>;

}

export namespace AccountPasskeysModel.PasskeyID {

    export const Params = z.object({
        passkeyID: z.string().min(1).max(1024).describe("ID of the passkey (its WebAuthn credential ID)")
    });

    export type Params = z.infer<typeof Params>;

}

export namespace AccountPasskeysModel.GetAll {

    export const Response = z.array(AccountPasskeysModel.Passkey);
    export type Response = z.infer<typeof Response>;

}

export namespace AccountPasskeysModel.RegistrationOptions {

    export const Body = z.object({
        current_password: z.string().min(1).describe("Current password — required to add a passkey")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        options: WebAuthnModels.CreationOptions
    });

    export type Response = z.infer<typeof Response>;

}

export namespace AccountPasskeysModel.Create {

    export const Body = z.object({
        name: AccountPasskeysModel.Name,
        response: WebAuthnModels.RegistrationResponse
    });

    export type Body = z.infer<typeof Body>;

    export const Response = AccountPasskeysModel.Passkey;
    export type Response = z.infer<typeof Response>;

}

export namespace AccountPasskeysModel.Update {

    export const Body = z.object({
        name: AccountPasskeysModel.Name
    });

    export type Body = z.infer<typeof Body>;

    export const Response = AccountPasskeysModel.Passkey;
    export type Response = z.infer<typeof Response>;

}
