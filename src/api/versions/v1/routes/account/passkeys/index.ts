import { Hono } from "hono";
import { validator } from "hono-openapi";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { AccountPasskeysModel } from "./model";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { AuthHandler, AuthUtils } from "../../../../../utils/authHandler";
import { PasskeyService } from "../../../../../utils/services/passkeyService";
import { DOCS_TAGS } from "../../../docs";

export const router = new Hono().basePath('/passkeys');

const toPasskeyResponse = (passkey: AccountPasskeysModel.Passkey) => AccountPasskeysModel.Passkey.parse(passkey);

router.get('/',

    APIRouteSpec.authenticated({
        summary: "Get all passkeys",
        description: "List the passkeys registered for the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT_PASSKEYS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Passkeys retrieved successfully", AccountPasskeysModel.GetAll.Response)
        )
    }),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const passkeys = PasskeyService.listForUser(authContext.user_id).map(toPasskeyResponse);

        return APIResponse.success(c, "Passkeys retrieved successfully", passkeys satisfies AccountPasskeysModel.GetAll.Response);
    }
);

router.post('/options',

    APIRouteSpec.authenticated({
        summary: "Start passkey registration",
        description: "Create the options to pass to `navigator.credentials.create()`. The challenge belongs to the current session and expires after 5 minutes.",
        tags: [DOCS_TAGS.ACCOUNT_PASSKEYS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Passkey registration started", AccountPasskeysModel.RegistrationOptions.Response),
            APIResponseSpec.badRequest("Current password is incorrect / Syntax or validation error in request"),
            APIResponseSpec.tooManyRequests("Too many pending passkey requests. Try again later.")
        )
    }),

    validator("json", AccountPasskeysModel.RegistrationOptions.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);
        const { current_password } = c.req.valid("json");

        const user = await AuthUtils.verifyUserPassword(authContext.user_id, current_password);
        if (!user) {
            return APIResponse.badRequest(c, "Current password is incorrect");
        }

        const options = await PasskeyService.createRegistrationOptions(user, authContext.id);
        if (!options) {
            c.header("Retry-After", PasskeyService.challengeSeconds.toString());
            return APIResponse.tooManyRequests(c, "Too many pending passkey requests. Try again later.");
        }

        return APIResponse.success(c, "Passkey registration started", { options } satisfies AccountPasskeysModel.RegistrationOptions.Response);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Register a passkey",
        description: "Verify the credential created with the options from `POST /account/passkeys/options` and add it to the account.",
        tags: [DOCS_TAGS.ACCOUNT_PASSKEYS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.created("Passkey registered successfully", AccountPasskeysModel.Create.Response),
            APIResponseSpec.badRequest("Passkey could not be verified / Syntax or validation error in request")
        )
    }),

    validator("json", AccountPasskeysModel.Create.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);
        const { name, response } = c.req.valid("json");

        const passkey = await PasskeyService.register(authContext.user_id, authContext.id, name, response as RegistrationResponseJSON);
        if (!passkey) {
            return APIResponse.badRequest(c, "Passkey could not be verified");
        }

        return APIResponse.created(c, "Passkey registered successfully", toPasskeyResponse(passkey) satisfies AccountPasskeysModel.Create.Response);
    }
);

router.put('/:passkeyID',

    APIRouteSpec.authenticated({
        summary: "Rename a passkey",
        description: "Change the name of one of the account's passkeys.",
        tags: [DOCS_TAGS.ACCOUNT_PASSKEYS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Passkey updated successfully", AccountPasskeysModel.Update.Response),
            APIResponseSpec.notFound("Passkey not found")
        )
    }),

    validator("param", AccountPasskeysModel.PasskeyID.Params),
    validator("json", AccountPasskeysModel.Update.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);
        const { passkeyID } = c.req.valid("param");
        const { name } = c.req.valid("json");

        const passkey = PasskeyService.rename(authContext.user_id, passkeyID, name);
        if (!passkey) {
            return APIResponse.notFound(c, "Passkey not found");
        }

        return APIResponse.success(c, "Passkey updated successfully", toPasskeyResponse(passkey) satisfies AccountPasskeysModel.Update.Response);
    }
);

router.delete('/:passkeyID',

    APIRouteSpec.authenticated({
        summary: "Delete a passkey",
        description: "Remove one of the account's passkeys. It can no longer be used to sign in.",
        tags: [DOCS_TAGS.ACCOUNT_PASSKEYS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Passkey deleted successfully"),
            APIResponseSpec.notFound("Passkey not found")
        )
    }),

    validator("param", AccountPasskeysModel.PasskeyID.Params),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);
        const { passkeyID } = c.req.valid("param");

        const deleted = PasskeyService.delete(authContext.user_id, passkeyID);
        if (!deleted) {
            return APIResponse.notFound(c, "Passkey not found");
        }

        return APIResponse.successNoData(c, "Passkey deleted successfully");
    }
);
