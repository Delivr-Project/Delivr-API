import { Hono } from "hono";
import { AccountAPIKeysModel } from './model'
import { validator } from "hono-openapi";
import { DB } from "../../../../db";
import { and, eq } from "drizzle-orm";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { APIKeyHandler, AuthHandler, AuthUtils, SessionHandler } from "../../../utils/authHandler";
import { DOCS_TAGS } from "../../../docs";

export const router = new Hono().basePath('/apikeys');

router.get('/',
    
    APIRouteSpec.authenticated({
        summary: "Get all API keys",
        description: "Retrieve all API keys for the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT_API_KEYS],
        
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("API keys retrieved successfully", AccountAPIKeysModel.GetById.Response.array() ),
        )

    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        const apiKeys = DB.instance().select().from(DB.Schema.apiKeys).where(
            eq(DB.Schema.apiKeys.user_id, authContext.user_id)
        ).all();

        const apiKeysWithoutSensitive = apiKeys.map(key => AccountAPIKeysModel.GetById.Response.parse(key));

        return APIResponse.success(c, "API keys retrieved successfully", apiKeysWithoutSensitive);
    }

);

router.post('/',
    
    APIRouteSpec.authenticated({
        summary: "Create a new API key",
        description: "Create a new API key for the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT_API_KEYS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("API key created successfully", AccountAPIKeysModel.Create.Response),
        )

    }),

    validator("json", AccountAPIKeysModel.Create.Body),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        const apiKeyData = c.req.valid("json");

        let expirationInDays: number | undefined;

        switch (apiKeyData.expires_at) {
            case "7d":
                expirationInDays = 7;
                break;
            case "30d":
                expirationInDays = 30;
                break;
            case "90d":
                expirationInDays = 90;
                break;
            case "180d":
                expirationInDays = 180;
                break;
            case "365d":
                expirationInDays = 365;
                break;
            default:
                expirationInDays = undefined;
                break
        }

        const key = await APIKeyHandler.createApiKey(authContext.user_id, apiKeyData.description, expirationInDays);
        const tokenID = AuthUtils.getTokenParts(key.token)?.id;

        if (!tokenID) {
            throw new Error("Failed to parse token ID from generated API key");
        }

        const keyWithoutSensitive = {
            id: tokenID,
            token: key.token
        }

        return APIResponse.success(c, "API key created successfully", keyWithoutSensitive satisfies AccountAPIKeysModel.Create.Response);
    }

);


router.delete('/:apiKeyID',

    APIRouteSpec.authenticated({
        summary: "Delete an API key",
        description: "Delete an API key by its ID for the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT_API_KEYS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("API key deleted successfully"),
            APIResponseSpec.notFound("API key not found")
        ) 
    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        const apiKeyID = c.req.param("apiKeyID");

        const apiKey = await DB.instance().select().from(DB.Schema.apiKeys).where(and(
            eq(DB.Schema.apiKeys.id, apiKeyID),
            eq(DB.Schema.apiKeys.user_id, authContext.user_id)
        )).get();

        if (!apiKey) {
            return APIResponse.notFound(c, "API key not found");
        }

        await APIKeyHandler.deleteApiKey(apiKeyID);

        return APIResponse.successNoData(c, "API key deleted successfully");
    }

);