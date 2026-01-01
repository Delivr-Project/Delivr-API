import { createMiddleware } from 'hono/factory'
import { APIResponse } from "../utils/api-res";
import { AuthHandler } from '../utils/authHandler';

export const authMiddleware = createMiddleware(async (c, next) => {

    if (
        c.req.path.startsWith("/auth/login") || c.req.path.startsWith("/auth/signup") ||
        c.req.path.startsWith("/auth/reset-password") ||
        c.req.path.startsWith("/docs") ||
        c.req.path.startsWith("/favicon.ico") ||
        c.req.path === "/"
    ) {
        return await next();
    }

    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return APIResponse.unauthorized(c, "Missing or invalid Authorization header");
    }

    const token = authHeader.substring("Bearer ".length);

    const authContext = await AuthHandler.getAuthContext(token);

    if (!authContext || !(await AuthHandler.isValidAuthContext(authContext))) {
        return APIResponse.unauthorized(c, "Invalid or expired token");
    }

    c.set("authContext", authContext);

    return await next();

});