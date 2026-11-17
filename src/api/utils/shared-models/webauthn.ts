import z from "zod";

export namespace WebAuthnModels {

    export const RegistrationResponse = z.object({
        id: z.string().min(1),
        rawId: z.string().min(1),
        response: z.object({
            clientDataJSON: z.string(),
            attestationObject: z.string(),
            authenticatorData: z.string().optional(),
            transports: z.array(z.string()).optional(),
            publicKeyAlgorithm: z.number().optional(),
            publicKey: z.string().optional()
        }),
        authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
        clientExtensionResults: z.record(z.string(), z.unknown()),
        type: z.literal("public-key")
    }).describe("Credential returned by navigator.credentials.create(), serialized as JSON");

    export type RegistrationResponse = z.infer<typeof RegistrationResponse>;

    export const AuthenticationResponse = z.object({
        id: z.string().min(1),
        rawId: z.string().min(1),
        response: z.object({
            clientDataJSON: z.string(),
            authenticatorData: z.string(),
            signature: z.string(),
            userHandle: z.string().optional()
        }),
        authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
        clientExtensionResults: z.record(z.string(), z.unknown()),
        type: z.literal("public-key")
    }).describe("Credential returned by navigator.credentials.get(), serialized as JSON");

    export type AuthenticationResponse = z.infer<typeof AuthenticationResponse>;

    export const CreationOptions = z.looseObject({
        challenge: z.string()
    }).describe("PublicKeyCredentialCreationOptionsJSON to pass to navigator.credentials.create()");

    export type CreationOptions = z.infer<typeof CreationOptions>;

    export const RequestOptions = z.looseObject({
        challenge: z.string()
    }).describe("PublicKeyCredentialRequestOptionsJSON to pass to navigator.credentials.get()");

    export type RequestOptions = z.infer<typeof RequestOptions>;

}
