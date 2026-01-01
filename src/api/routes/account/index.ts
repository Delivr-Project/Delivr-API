import { Hono } from "hono";
import { AccountModel } from './model'
import { validator } from "hono-openapi";
import { DB } from "../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../utils/specHelpers";
import { AuthHandler, SessionHandler } from "../../utils/authHandler";
import { DOCS_TAGS } from "../../docs";
import { router as apiKeyRouter } from "./apikeys";

export const router = new Hono().basePath('/account');

// all routes below require authentication via session
router.use("*", async (c, next) => {
    // @ts-ignore
    const authContext = c.get("authContext") as AuthHandler.AuthContext;

    if (authContext.type !== 'session') {
        return APIResponse.unauthorized(c, "Your Auth Context is not a session");
    }

    await next();
});

router.get('/',

    APIRouteSpec.authenticated({
        summary: "Get account information",
        description: "Retrieve information about the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Account information retrieved successfully", AccountModel.GetInfo.Response),
            APIResponseSpec.unauthorized("Your Auth Context is not a session")
        )
    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        const user = DB.instance().select().from(DB.Schema.users).where(
            eq(DB.Schema.users.id, authContext.user_id)
        ).get();

        if (!user) {
            throw new Error("User not found but session exists");
        }

        const userWithoutSensitive = AccountModel.GetInfo.Response.parse(user);

        return APIResponse.success(c, "Account information retrieved successfully", userWithoutSensitive);
    },
);

router.put('/',

    APIRouteSpec.authenticated({
        summary: "Update account information",
        description: "Update information about the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Account information updated successfully"), 
            APIResponseSpec.unauthorized("Your Auth Context is not a session")
        )
    }),

    validator("json", AccountModel.UpdateInfo.Body),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        const body = c.req.valid("json") as AccountModel.UpdateInfo.Body;

        DB.instance().update(DB.Schema.users).set(body).where(
            eq(DB.Schema.users.id, authContext.user_id)
        ).run();

        return APIResponse.successNoData(c, "Account information updated successfully");
    },
);

router.put('/password',

    APIRouteSpec.authenticated({
        summary: "Change account password",
        description: "Change the password of the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Password changed successfully"),
            APIResponseSpec.unauthorized("Your Auth Context is not a session"),
            APIResponseSpec.badRequest("Current password is incorrect / Syntax or validation error in request")
        )
    }),

    validator("json", AccountModel.UpdatePassword.Body),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        if (authContext.type !== 'session') {
            return APIResponse.unauthorized(c, "Your Auth Context is not a session");
        }

        const body = c.req.valid("json")

        const user = DB.instance().select().from(DB.Schema.users).where(
            eq(DB.Schema.users.id, authContext.user_id)
        ).get();
    
        if (!user) {
            throw new Error("User not found but session exists");
        }

        if ((await Bun.password.verify(body.current_password, user.password_hash)) === false) {
            return APIResponse.unauthorized(c, "Current password is incorrect");
        }

        const newPasswordHash = await Bun.password.hash(body.new_password);

        DB.instance().update(DB.Schema.users).set({
            password_hash: newPasswordHash
        }).where(
            eq(DB.Schema.users.id, authContext.user_id)
        ).run();

        await SessionHandler.inValidateAllSessionsForUser(authContext.user_id);

        return APIResponse.successNoData(c, "Password changed successfully");
    },
);


router.delete('/',

    APIRouteSpec.authenticated({
        summary: "Delete account",
        description: "Permanently delete the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Account deleted successfully"),
            APIResponseSpec.unauthorized("Your Auth Context is not a session")
        )
    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        // check if it have still packages owned
        const ownedPackages = await DB.instance().select().from(DB.Schema.packages).where(
            eq(DB.Schema.packages.owner_user_id, authContext.user_id)
        );

        if (ownedPackages.length > 0) {
            return APIResponse.badRequest(c, "You must delete all your packages before deleting your account.");
        }

        // invalidate all sessions for the user
        await SessionHandler.inValidateAllSessionsForUser(authContext.user_id);

        // delete password resets
        DB.instance().delete(DB.Schema.passwordResets).where(
            eq(DB.Schema.passwordResets.user_id, authContext.user_id)
        ).run();

        // finally, delete the user account
        DB.instance().delete(DB.Schema.users).where(
            eq(DB.Schema.users.id, authContext.user_id)
        ).run();

        return APIResponse.successNoData(c, "Account deleted successfully");
    },
);

router.route("/", apiKeyRouter);