import { Hono } from "hono";
import { ResetPasswordModel } from './model'
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../../utils/api-res";
import { AuthHandler, SessionHandler } from "../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { randomBytes as crypto_randomBytes } from "crypto" 

export const router = new Hono().basePath('/reset-password');

router.post('/',

    APIRouteSpec.unauthenticated({
        summary: "Reset your password for reset token",
        description: "Reset your password using a valid reset token",
        tags: [DOCS_TAGS.AUTHENTICATION],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.badRequest("Invalid reset token"),
            APIResponseSpec.serverError("User for reset token not found"),
            APIResponseSpec.successNoData("Password has been reset successfully")
        ),
    }),

    zValidator("json", ResetPasswordModel.Reset.Body),

    async (c) => {
        const resetData = c.req.valid("json");

        const checkToken = DB.instance().select().from(DB.Schema.passwordResets).where(
            eq(DB.Schema.passwordResets.token, resetData.reset_token)
        ).get();

        if (!checkToken) {
            return APIResponse.badRequest(c, "Invalid reset token");
        }

        if (checkToken.expires_at < Date.now()) {
            return APIResponse.badRequest(c, "Invalid reset token");
        }

        const user = DB.instance().select().from(DB.Schema.users).where(
            eq(DB.Schema.users.id, checkToken.user_id)
        ).get();

        if (!user) {
            return APIResponse.serverError(c, "User for reset token not found");
        }

        const newPasswordHash = await Bun.password.hash(resetData.new_password);

        DB.instance().update(DB.Schema.users).set({
            password_hash: newPasswordHash
        }).where(
            eq(DB.Schema.users.id, user.id)
        ).run();

        await SessionHandler.inValidateAllSessionsForUser(user.id);

        // Delete used reset token
        DB.instance().delete(DB.Schema.passwordResets).where(
            eq(DB.Schema.passwordResets.token, resetData.reset_token)
        ).run();

        return APIResponse.successNoData(c, "Password has been reset successfully");
    }
);

router.post('/request',

    APIRouteSpec.unauthenticated({
        summary: "Request Password Reset",
        description: "Request a password reset for a user using their username",
        tags: [DOCS_TAGS.AUTHENTICATION],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("If the username exists, a password reset has been requested")
        ),
    }),

    zValidator("json", ResetPasswordModel.RequestReset.Body),

    async (c) => {
        const requestData = c.req.valid("json");

        const user = DB.instance().select().from(DB.Schema.users).where(
            eq(DB.Schema.users.email, requestData.email)
        ).get();

        if (user) {
            const resetToken = crypto_randomBytes(64).toString('hex');

            // Delete any existing reset tokens for this user
            DB.instance().delete(DB.Schema.passwordResets).where(
                eq(DB.Schema.passwordResets.user_id, user.id)
            ).run();

            // Create new reset token
            DB.instance().insert(DB.Schema.passwordResets).values({
                user_id: user.id,
                token: resetToken,
                // 7 Days
                expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000
            }).run();

            // send email with reset token
            // Note: Email sending is not implemented yet
        }

        return APIResponse.successNoData(c, "If the username exists, a password reset has been requested");
    }
);

