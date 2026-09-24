import { Hono } from "hono";
import { AccountPreferencesModel } from './model'
import { validator } from "hono-openapi";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { AuthHandler } from "../../../../../utils/authHandler";
import { UserPreferencesHandler } from "../../../../../utils/preferences";
import { DOCS_TAGS } from "../../../docs";

export const router = new Hono().basePath('/preferences');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "Get all preferences",
        description: "Retrieve all of the authenticated user's preferences in a single request, keyed by the same names as the per-preference routes. Preferences that were never set are returned with their defaults.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Preferences retrieved successfully", AccountPreferencesModel.GetAll.Response),
        )
    }),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const preferences = await UserPreferencesHandler.getAll(authContext.user_id);

        return APIResponse.success(c, "Preferences retrieved successfully", preferences);
    }

);

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

router.get('/auto-mark-seen',

    APIRouteSpec.authenticated({
        summary: "Get auto-mark-as-seen preference",
        description: "Retrieve whether opening/viewing a mail automatically marks it as seen for the authenticated user.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Auto-mark-as-seen preference retrieved successfully", AccountPreferencesModel.AutoMarkSeen.Response),
        )
    }),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const preference = await UserPreferencesHandler.getAutoMarkSeen(authContext.user_id);

        return APIResponse.success(c, "Auto-mark-as-seen preference retrieved successfully", preference);
    }

);

router.put('/auto-mark-seen',

    APIRouteSpec.authenticated({
        summary: "Update auto-mark-as-seen preference",
        description: "Set whether opening/viewing a mail automatically marks it as seen for the authenticated user.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Auto-mark-as-seen preference updated successfully"),
        )
    }),

    validator("json", AccountPreferencesModel.AutoMarkSeen.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const body = c.req.valid("json");

        await UserPreferencesHandler.setAutoMarkSeen(authContext.user_id, body);

        return APIResponse.successNoData(c, "Auto-mark-as-seen preference updated successfully");
    }

);

router.get('/folder-nesting',

    APIRouteSpec.authenticated({
        summary: "Get folder-nesting preference",
        description: "Retrieve whether the sidebar nests INBOX sub-folders under the Inbox item for the authenticated user.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Folder-nesting preference retrieved successfully", AccountPreferencesModel.FolderNesting.Response),
        )
    }),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const preference = await UserPreferencesHandler.getFolderNesting(authContext.user_id);

        return APIResponse.success(c, "Folder-nesting preference retrieved successfully", preference);
    }

);

router.put('/folder-nesting',

    APIRouteSpec.authenticated({
        summary: "Update folder-nesting preference",
        description: "Set whether the sidebar nests INBOX sub-folders under the Inbox item for the authenticated user.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Folder-nesting preference updated successfully"),
        )
    }),

    validator("json", AccountPreferencesModel.FolderNesting.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const body = c.req.valid("json");

        await UserPreferencesHandler.setFolderNesting(authContext.user_id, body);

        return APIResponse.successNoData(c, "Folder-nesting preference updated successfully");
    }

);

router.get('/folder-dnd',

    APIRouteSpec.authenticated({
        summary: "Get folder drag-and-drop preference",
        description: "Retrieve whether folders can be reorganised by drag-and-drop in the sidebar for the authenticated user.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Folder drag-and-drop preference retrieved successfully", AccountPreferencesModel.FolderDnd.Response),
        )
    }),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const preference = await UserPreferencesHandler.getFolderDnd(authContext.user_id);

        return APIResponse.success(c, "Folder drag-and-drop preference retrieved successfully", preference);
    }

);

router.put('/folder-dnd',

    APIRouteSpec.authenticated({
        summary: "Update folder drag-and-drop preference",
        description: "Set whether folders can be reorganised by drag-and-drop in the sidebar for the authenticated user.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Folder drag-and-drop preference updated successfully"),
        )
    }),

    validator("json", AccountPreferencesModel.FolderDnd.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const body = c.req.valid("json");

        await UserPreferencesHandler.setFolderDnd(authContext.user_id, body);

        return APIResponse.successNoData(c, "Folder drag-and-drop preference updated successfully");
    }

);

router.get('/split-view-hover-actions',

    APIRouteSpec.authenticated({
        summary: "Get split-view hover actions preference",
        description: "Retrieve whether mail rows in the split view show archive / delete / read quick actions on hover for the authenticated user.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Split-view hover actions preference retrieved successfully", AccountPreferencesModel.SplitViewHoverActions.Response),
        )
    }),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const preference = await UserPreferencesHandler.getSplitViewHoverActions(authContext.user_id);

        return APIResponse.success(c, "Split-view hover actions preference retrieved successfully", preference);
    }

);

router.put('/split-view-hover-actions',

    APIRouteSpec.authenticated({
        summary: "Update split-view hover actions preference",
        description: "Set whether mail rows in the split view show archive / delete / read quick actions on hover for the authenticated user.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Split-view hover actions preference updated successfully"),
        )
    }),

    validator("json", AccountPreferencesModel.SplitViewHoverActions.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const body = c.req.valid("json");

        await UserPreferencesHandler.setSplitViewHoverActions(authContext.user_id, body);

        return APIResponse.successNoData(c, "Split-view hover actions preference updated successfully");
    }

);

router.get('/onboarding',

    APIRouteSpec.authenticated({
        summary: "Get onboarding state",
        description: "Retrieve whether the authenticated user has completed the one-time, platform-wide welcome onboarding.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Onboarding state retrieved successfully", AccountPreferencesModel.Onboarding.Response),
        )
    }),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const preference = await UserPreferencesHandler.getOnboarding(authContext.user_id);

        return APIResponse.success(c, "Onboarding state retrieved successfully", preference);
    }

);

router.put('/onboarding',

    APIRouteSpec.authenticated({
        summary: "Update onboarding state",
        description: "Set whether the authenticated user has completed the one-time, platform-wide welcome onboarding.",
        tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Onboarding state updated successfully"),
        )
    }),

    validator("json", AccountPreferencesModel.Onboarding.Body),

    async (c) => {
        const authContext = AuthHandler.AuthContext.getAsSession(c);

        const body = c.req.valid("json");

        await UserPreferencesHandler.setOnboarding(authContext.user_id, body);

        return APIResponse.successNoData(c, "Onboarding state updated successfully");
    }

);
