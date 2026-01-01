import { Hono } from "hono";
import { APIResponse } from "../../utils/api-res";
import { AuthHandler } from "../../utils/authHandler";

export const router = new Hono().basePath('/admin');

router.use("*", async (c, next) => {

    const authContext = AuthHandler.AuthContext.get(c);

    if (authContext.user_role !== 'admin') {
        return APIResponse.unauthorized(c, "This endpoint is restricted to Delivr instance admins.");
    }

    await next();
});

router.route("/", (await import('./users')).router);