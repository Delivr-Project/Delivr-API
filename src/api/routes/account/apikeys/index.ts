import { Hono } from "hono";
import { AccountAPIKeysModel } from './model'
import { validator } from "hono-openapi";
import { DB } from "../../../../db";
import { and, eq } from "drizzle-orm";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { APIKeyHandler, AuthHandler, SessionHandler } from "../../../utils/authHandler";
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

        let expirationTimestamp: number | undefined = undefined;

        switch (apiKeyData.expires_at) {
            case "7d":
                expirationTimestamp = Date.now() + 7 * 24 * 60 * 60 * 1000;
                break;
            case "30d":
                expirationTimestamp = Date.now() + 30 * 24 * 60 * 60 * 1000;
                break;
            case "90d":
                expirationTimestamp = Date.now() + 90 * 24 * 60 * 60 * 1000;
                break;
            case "180d":
                expirationTimestamp = Date.now() + 180 * 24 * 60 * 60 * 1000;
                break;
            case "365d":
                expirationTimestamp = Date.now() + 365 * 24 * 60 * 60 * 1000;
                break;
            default:
                expirationTimestamp = undefined;
                break
        }

        const key = await APIKeyHandler.createApiKey(authContext.user_id, apiKeyData.description, expirationTimestamp);

        const keyWithoutSensitive = AccountAPIKeysModel.Create.Response.parse(key);

        return APIResponse.success(c, "API key created successfully", keyWithoutSensitive);
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