import { Hono } from "hono";
import { AccountPreferencesModel } from './model'
import { validator } from "hono-openapi";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { AuthHandler } from "../../../utils/authHandler";
import { UserPreferencesHandler } from "../../../utils/preferences";
import { DOCS_TAGS } from "../../../docs";

export const router = new Hono().basePath('/preferences');

router.get('/remote-content-policy',

    APIRouteSpec.authenticated({
        summary: "Get remote content policy",
        description: "Retrieve the authenticated user's per-address / per-domain policy for auto-loading remote images and resources in HTML emails.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Remote content policy retrieved successfully", AccountPreferencesModel.RemoteContentPolicy.Response),
        )
    }),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const policy = await UserPreferencesHandler.getRemoteContentPolicy(authContext.user_id);

        return APIResponse.success(c, "Remote content policy retrieved successfully", policy);
    }

);

router.put('/remote-content-policy',

    APIRouteSpec.authenticated({
        summary: "Replace remote content policy",
        description: "Replace the authenticated user's per-address / per-domain policy for auto-loading remote images and resources in HTML emails.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Remote content policy updated successfully"),
        )
    }),

    validator("json", AccountPreferencesModel.RemoteContentPolicy.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const body = c.req.valid("json");

        await UserPreferencesHandler.setRemoteContentPolicy(authContext.user_id, body);

        return APIResponse.successNoData(c, "Remote content policy updated successfully");
    }

);

router.get('/mail-list-page-size',

    APIRouteSpec.authenticated({
        summary: "Get mail list page size",
        description: "Retrieve the authenticated user's preferred number of mails shown per page in a mailbox list.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail list page size retrieved successfully", AccountPreferencesModel.MailListPageSize.Response),
        )
    }),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const preference = await UserPreferencesHandler.getMailListPageSize(authContext.user_id);

        return APIResponse.success(c, "Mail list page size retrieved successfully", preference);
    }

);

router.put('/mail-list-page-size',

    APIRouteSpec.authenticated({
        summary: "Set mail list page size",
        description: "Replace the authenticated user's preferred number of mails shown per page in a mailbox list.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Mail list page size updated successfully"),
        )
    }),

    validator("json", AccountPreferencesModel.MailListPageSize.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const body = c.req.valid("json");

        await UserPreferencesHandler.setMailListPageSize(authContext.user_id, body);

        return APIResponse.successNoData(c, "Mail list page size updated successfully");
    }

);
