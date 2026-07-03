import { createMiddleware } from 'hono/factory'
import { APIResponse } from "../../../utils/api-res";
import { AuthHandler } from '../../../utils/authHandler';

export const authMiddlewareV1 = createMiddleware(async (c, next) => {

    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {

        if (
            c.req.path.startsWith("/v1/auth/login") || c.req.path.startsWith("/v1/auth/signup") ||
            c.req.path.startsWith("/v1/auth/reset-password")
        ) {
            AuthHandler.AuthContext.set(c, { type: 'unauthenticated' } satisfies AuthHandler.UnauthenticatedAuthContext as any);

            return await next();
        }

        return APIResponse.unauthorized(c, "Missing or invalid Authorization header");
    }

    const token = authHeader.substring("Bearer ".length);

    const authContext = await AuthHandler.getAuthContext(token);

    if (!authContext || !(await AuthHandler.isValidAuthContext(authContext))) {

        if (
            c.req.path.startsWith("/v1/auth/login") || c.req.path.startsWith("/v1/auth/signup") ||
            c.req.path.startsWith("/v1/auth/reset-password")
        ) {
            AuthHandler.AuthContext.set(c, { type: 'unauthenticated' } satisfies AuthHandler.UnauthenticatedAuthContext as any);

            return await next();
        }

        return APIResponse.unauthorized(c, "Invalid or expired token");
    }

    AuthHandler.AuthContext.set(c, authContext);

    return await next();

});