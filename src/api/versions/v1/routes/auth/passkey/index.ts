import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { PasskeyLoginModel } from "./model";
import { type DrizzleDB } from "../../../../../../db/utils";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { AuthHandler, SessionHandler } from "../../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { PasskeyService } from "../../../../../utils/services/passkeyService";
import { DOCS_TAGS } from "../../../docs";
import { getClientIP, getClientRateLimitKey } from "../../../../../utils/clientIP";

export const router = new Hono().basePath('/passkey');

router.post('/options',

    APIRouteSpec.unauthenticated({
        summary: "Start passkey login",
        description: "Create the options to pass to `navigator.credentials.get()` for signing in with a passkey instead of a password. The challenge expires after 5 minutes.",
        tags: [DOCS_TAGS.AUTHENTICATION],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Passkey challenge created", PasskeyLoginModel.Options.Response),
            APIResponseSpec.tooManyRequests("Too many pending passkey requests. Try again later.")
        )
    }),

    async (c) => {
        if (AuthHandler.AuthContext.isAuthenticated(c)) {
            return APIResponse.forbidden(c, "You are already authenticated");
        }

        const ip = getClientIP(c);
        const challenge = await PasskeyService.createLoginChallenge(ip === null ? null : getClientRateLimitKey(ip));
        if (!challenge) {
            c.header("Retry-After", PasskeyService.challengeSeconds.toString());
            return APIResponse.tooManyRequests(c, "Too many pending passkey requests. Try again later.");
        }

        return APIResponse.success(c, "Passkey challenge created", challenge satisfies PasskeyLoginModel.Options.Response);
    }
);

router.post('/',

    APIRouteSpec.unauthenticated({
        summary: "Login with a passkey",
        description: "Sign in with a passkey instead of the password. The passkey must have verified the user (PIN, biometrics).",
        tags: [DOCS_TAGS.AUTHENTICATION],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Login successful", PasskeyLoginModel.Login.Response),
            APIResponseSpec.badRequest("Invalid or expired passkey challenge / Syntax or validation error in request"),
            APIResponseSpec.unauthorized("Passkey could not be verified")
        )
    }),

    zValidator("json", PasskeyLoginModel.Login.Body),

    async (c) => {
        if (AuthHandler.AuthContext.isAuthenticated(c)) {
            return APIResponse.forbidden(c, "You are already authenticated");
        }

        const { challenge_id, response } = c.req.valid("json");

        const expectedChallenge = PasskeyService.takeLoginChallenge(challenge_id);
        if (!expectedChallenge) {
            return APIResponse.badRequest(c, "Invalid or expired passkey challenge");
        }

        const passkey = await PasskeyService.verifyAuthentication(response as AuthenticationResponseJSON, expectedChallenge);
        if (!passkey) {
            return APIResponse.unauthorized(c, "Passkey could not be verified");
        }

        const session = await DB.instance().transaction(async (tx: DrizzleDB) => {
            return await SessionHandler.createSession(passkey.user_id, tx);
        });

        return APIResponse.success(c, "Login successful", session satisfies PasskeyLoginModel.Login.Response);
    }
);
