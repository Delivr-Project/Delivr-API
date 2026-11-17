import z from "zod";
import { AuthModel } from "../model";
import { WebAuthnModels } from "../../../../../utils/shared-models/webauthn";

export namespace PasskeyLoginModel.Options {

    export const Response = z.object({
        challenge_id: z.string().describe("Pass back with the signed credential to `POST /auth/passkey`"),
        options: WebAuthnModels.RequestOptions
    });

    export type Response = z.infer<typeof Response>;

}

export namespace PasskeyLoginModel.Login {

    export const Body = z.object({
        challenge_id: z.string().min(1),
        response: WebAuthnModels.AuthenticationResponse
    });

    export type Body = z.infer<typeof Body>;

    export const Response = AuthModel.Login.Response;
    export type Response = z.infer<typeof Response>;

}
