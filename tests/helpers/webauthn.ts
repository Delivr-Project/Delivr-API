import { createHash, generateKeyPairSync, randomBytes, sign } from "crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import { PasskeyService } from "../../src/api/utils/services/passkeyService";

type CBORType = Parameters<typeof isoCBOR.encode>[0];

export class SoftwareAuthenticator {

    readonly credentialID = randomBytes(16);
    private readonly keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    private counter = 0;

    constructor(
        private readonly userVerification = true,
        private readonly relyingParty = PasskeyService.getRelyingParty()
    ) {}

    get id() {
        return isoBase64URL.fromBuffer(this.credentialID);
    }

    createRegistrationResponse(challenge: string) {
        const clientDataJSON = this.clientData("webauthn.create", challenge);

        const credentialIDLength = Buffer.alloc(2);
        credentialIDLength.writeUInt16BE(this.credentialID.length);

        const attestedCredentialData = Buffer.concat([
            Buffer.alloc(16),
            credentialIDLength,
            this.credentialID,
            Buffer.from(this.publicKeyCOSE())
        ]);

        const authenticatorData = this.authenticatorData(0x40, attestedCredentialData);

        const attestationObject = isoCBOR.encode(new Map<string, CBORType>([
            ["fmt", "none"],
            ["attStmt", new Map()],
            ["authData", authenticatorData]
        ]));

        return {
            id: this.id,
            rawId: this.id,
            type: "public-key" as const,
            clientExtensionResults: {},
            response: {
                clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
                attestationObject: isoBase64URL.fromBuffer(attestationObject),
                transports: ["internal"]
            }
        };
    }

    createAuthenticationResponse(challenge: string) {
        this.counter++;

        const clientDataJSON = this.clientData("webauthn.get", challenge);
        const authenticatorData = this.authenticatorData(0);
        const signature = sign("sha256", Buffer.concat([
            authenticatorData,
            createHash("sha256").update(clientDataJSON).digest()
        ]), this.keyPair.privateKey);

        return {
            id: this.id,
            rawId: this.id,
            type: "public-key" as const,
            clientExtensionResults: {},
            response: {
                clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
                authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
                signature: isoBase64URL.fromBuffer(signature)
            }
        };
    }

    private clientData(type: string, challenge: string) {
        return Buffer.from(JSON.stringify({
            type,
            challenge,
            origin: this.relyingParty.origin,
            crossOrigin: false
        }));
    }

    private authenticatorData(extraFlags: number, attestedCredentialData?: Buffer) {
        const flags = 0x01 | (this.userVerification ? 0x04 : 0) | extraFlags;

        const counter = Buffer.alloc(4);
        counter.writeUInt32BE(this.counter);

        return Buffer.concat([
            createHash("sha256").update(this.relyingParty.rpID).digest(),
            Buffer.from([flags]),
            counter,
            ...(attestedCredentialData ? [attestedCredentialData] : [])
        ]);
    }

    private publicKeyCOSE() {
        const jwk = this.keyPair.publicKey.export({ format: "jwk" });

        return isoCBOR.encode(new Map<number, CBORType>([
            [1, 2],
            [3, -7],
            [-1, 1],
            [-2, Buffer.from(jwk.x!, "base64url")],
            [-3, Buffer.from(jwk.y!, "base64url")]
        ]));
    }

}
