import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { DB } from "../../../db";
import type { DrizzleDB } from "../../../db/utils";
import { ConfigHandler } from "../../../utils/config";
import { Logger } from "../../../utils/logger";
import { ExpiringStore } from "../expiringStore";
import { RequestLimiter } from "../rateLimiters";

export class PasskeyService {

    static readonly RP_NAME = "Delivr";

    private static readonly CHALLENGE_TTL_MS = 5 * 60 * 1000;

    private static readonly registrationChallenges = new ExpiringStore<string>(this.CHALLENGE_TTL_MS);
    private static readonly loginChallenges = new ExpiringStore<string>(this.CHALLENGE_TTL_MS);
    private static readonly loginChallengeRequests = new RequestLimiter(this.CHALLENGE_TTL_MS, 30);

    private static webAuthn: Promise<PasskeyService.WebAuthn> | null = null;

    /**
     * The WebAuthn library, loaded on first use. A static import costs every
     * start ~50 ms in the compiled binary (~170 ms from source), whether or
     * not anyone uses a passkey.
     */
    private static loadWebAuthn() {
        this.webAuthn ??= Promise.all([
            import("@simplewebauthn/server"),
            import("@simplewebauthn/server/helpers")
        ]).then(([server, helpers]) => ({ ...server, ...helpers })).catch((error) => {
            this.webAuthn = null;
            throw error;
        });

        return this.webAuthn;
    }

    static get challengeSeconds() {
        return Math.ceil(this.CHALLENGE_TTL_MS / 1000);
    }

    static getRelyingParty() {
        const appURL = ConfigHandler.getConfig()?.DLA_APP_URL;
        if (!appURL) {
            throw new Error("DLA_APP_URL is not configured");
        }

        const { hostname, origin } = new URL(appURL);

        return {
            rpID: hostname,
            origin
        };
    }

    static listForUser(userID: number, tx: DrizzleDB = DB.instance()) {
        return tx.select().from(DB.Tables.userPasskeys).where(
            eq(DB.Tables.userPasskeys.user_id, userID)
        ).all();
    }

    static getForUser(userID: number, passkeyID: string, tx: DrizzleDB = DB.instance()) {
        return tx.select().from(DB.Tables.userPasskeys).where(and(
            eq(DB.Tables.userPasskeys.id, passkeyID),
            eq(DB.Tables.userPasskeys.user_id, userID)
        )).get();
    }

    static async createRegistrationOptions(user: DB.Models.User, sessionID: string, tx: DrizzleDB = DB.instance()) {
        const { rpID } = this.getRelyingParty();
        const { generateRegistrationOptions, isoUint8Array } = await this.loadWebAuthn();

        const options = await generateRegistrationOptions({
            rpName: this.RP_NAME,
            rpID,
            userName: user.username,
            userDisplayName: user.display_name,
            userID: isoUint8Array.fromUTF8String(String(user.id)),
            attestationType: "none",
            excludeCredentials: this.listForUser(user.id, tx).map(passkey => ({
                id: passkey.id,
                transports: passkey.transports
            })),
            authenticatorSelection: {
                residentKey: "required",
                userVerification: "preferred"
            }
        });

        if (this.registrationChallenges.set(sessionID, options.challenge) === null) {
            return null;
        }

        return { ...options };
    }

    static async register(userID: number, sessionID: string, name: string, response: RegistrationResponseJSON, tx: DrizzleDB = DB.instance()) {
        const expectedChallenge = this.registrationChallenges.take(sessionID);
        if (!expectedChallenge) return null;

        const { rpID, origin } = this.getRelyingParty();
        const { verifyRegistrationResponse, isoBase64URL } = await this.loadWebAuthn();

        try {
            const verification = await verifyRegistrationResponse({
                response,
                expectedChallenge,
                expectedOrigin: origin,
                expectedRPID: rpID,
                requireUserVerification: false
            });

            if (!verification.verified) return null;

            const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

            const existing = tx.select({ id: DB.Tables.userPasskeys.id }).from(DB.Tables.userPasskeys).where(
                eq(DB.Tables.userPasskeys.id, credential.id)
            ).get();
            if (existing) return null;

            return tx.insert(DB.Tables.userPasskeys).values({
                id: credential.id,
                user_id: userID,
                name,
                public_key: isoBase64URL.fromBuffer(credential.publicKey),
                counter: credential.counter,
                transports: credential.transports ?? response.response.transports ?? [],
                device_type: credentialDeviceType,
                backed_up: credentialBackedUp
            }).returning().get();
        } catch (error: any) {
            Logger.debug("Passkey registration failed", error.message || error);
            return null;
        }
    }

    static async createLoginChallenge(client: string | null) {
        if (!this.loginChallengeRequests.hit(client)) {
            return null;
        }

        const { rpID } = this.getRelyingParty();
        const { generateAuthenticationOptions } = await this.loadWebAuthn();

        // No allowCredentials: the browser offers every passkey it has for this site.
        const options = { ...await generateAuthenticationOptions({ rpID, userVerification: "required" }) };
        const challengeID = randomBytes(32).toString("hex");

        if (this.loginChallenges.set(challengeID, options.challenge) === null) {
            return null;
        }

        return { challenge_id: challengeID, options };
    }

    static takeLoginChallenge(challengeID: string) {
        return this.loginChallenges.take(challengeID);
    }

    static async verifyAuthentication(response: AuthenticationResponseJSON, expectedChallenge: string, tx: DrizzleDB = DB.instance()) {
        const passkey = tx.select().from(DB.Tables.userPasskeys).where(
            eq(DB.Tables.userPasskeys.id, response.id)
        ).get();

        if (!passkey) {
            return null;
        }

        const { rpID, origin } = this.getRelyingParty();
        const { verifyAuthenticationResponse, isoBase64URL } = await this.loadWebAuthn();

        try {
            const verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge,
                expectedOrigin: origin,
                expectedRPID: rpID,
                requireUserVerification: true,
                credential: {
                    id: passkey.id,
                    publicKey: isoBase64URL.toBuffer(passkey.public_key),
                    counter: passkey.counter,
                    transports: passkey.transports
                }
            });

            if (!verification.verified) return null;

            tx.update(DB.Tables.userPasskeys).set({
                counter: verification.authenticationInfo.newCounter,
                backed_up: verification.authenticationInfo.credentialBackedUp,
                last_used_at: Date.now()
            }).where(
                eq(DB.Tables.userPasskeys.id, passkey.id)
            ).run();

            return passkey;
        } catch (error: any) {
            Logger.debug("Passkey authentication failed", error.message || error);
            return null;
        }
    }

    static rename(userID: number, passkeyID: string, name: string, tx: DrizzleDB = DB.instance()) {
        return tx.update(DB.Tables.userPasskeys).set({ name }).where(and(
            eq(DB.Tables.userPasskeys.id, passkeyID),
            eq(DB.Tables.userPasskeys.user_id, userID)
        )).returning().get();
    }

    static delete(userID: number, passkeyID: string, tx: DrizzleDB = DB.instance()) {
        return tx.delete(DB.Tables.userPasskeys).where(and(
            eq(DB.Tables.userPasskeys.id, passkeyID),
            eq(DB.Tables.userPasskeys.user_id, userID)
        )).returning({ id: DB.Tables.userPasskeys.id }).get();
    }

}

export namespace PasskeyService {

    export type WebAuthn = typeof import("@simplewebauthn/server") & typeof import("@simplewebauthn/server/helpers");

}
