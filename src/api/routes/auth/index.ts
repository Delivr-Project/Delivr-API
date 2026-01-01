import { Hono } from "hono";
import type { Context } from "hono";
import { AuthModel } from './model'
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../utils/api-res";
import { AuthHandler, SessionHandler } from "../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../utils/specHelpers";
import { router as resetPasswordRouter } from "./reset-password";
import { DOCS_TAGS } from "../../docs";

// Simple in-memory rate limiter for login to reduce brute-force risk
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function getClientId(c: Context) {
    // Prefer forwarded header, fallback to remote IP if available
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    // @ts-ignore bun/hono provides a native request with connection info
    const remote = (c.req.raw as any)?.remoteAddr?.hostname;
    return forwarded || remote || "unknown";
}

function isLoginRateLimited(clientId: string) {
    const now = Date.now();
    const entry = loginAttempts.get(clientId);

    if (!entry || entry.resetAt <= now) {
        loginAttempts.set(clientId, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
        return { limited: false };
    }

    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        return { limited: true, retryAfterMs: entry.resetAt - now };
    }

    entry.count += 1;
    return { limited: false };
}

export const router = new Hono().basePath('/auth');

router.post('/login',

    APIRouteSpec.unauthenticated({
        summary: "User Login",
        description: "Authenticate a user with their username and password",
        tags: [DOCS_TAGS.AUTHENTICATION],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Login successful", AuthModel.Login.Response),
            APIResponseSpec.unauthorized("Unauthorized: Invalid username or password"),
            APIResponseSpec.tooManyRequests("Too many login attempts. Try again later.")
        ),

    }),

    zValidator("json", AuthModel.Login.Body),
    
    async (c) => {
        const clientId = getClientId(c);
        const rate = isLoginRateLimited(clientId);
        if (rate.limited) {
            const retrySeconds = Math.max(1, Math.ceil((rate.retryAfterMs ?? LOGIN_WINDOW_MS) / 1000));
            c.header("Retry-After", retrySeconds.toString());
            return c.json({ success: false, code: 429, message: `Too many login attempts. Try again in ${retrySeconds}s` }, 429);
        }

        const { username, password } = c.req.valid("json");

        const user = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.username, username)).get();
        if (!user) {
            return APIResponse.unauthorized(c, "Invalid username or password");
        }

        const passwordMatch = await Bun.password.verify(password, user.password_hash);
        if (!passwordMatch) {
            return APIResponse.unauthorized(c, "Invalid username or password");
        }

        const session = await SessionHandler.createSession(user.id);

        return APIResponse.success(c, "Login successful", session satisfies AuthModel.Login.Response);
    }
);

router.get('/session',

    APIRouteSpec.authenticated({
        summary: "Get Current Session",
        description: "Retrieve the current user's session information",
        tags: [DOCS_TAGS.AUTHENTICATION],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Session info retrieved successfully", AuthModel.Session.Response),
            APIResponseSpec.unauthorized("Unauthorized: Invalid or missing session token / Your Auth Context is not a session"),
        )

    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        if (authContext.type !== 'session') {
            return APIResponse.unauthorized(c, "Your Auth Context is not a session");
        }

        return APIResponse.success(c, "Session info retrieved successfully", {
            user_id: authContext.user_id,
            user_role: authContext.user_role,
            created_at: authContext.created_at,
            expires_at: authContext.expires_at
        } satisfies AuthModel.Session.Response);
    }
);

router.post('/logout',

    APIRouteSpec.authenticated({
        summary: "User Logout",
        description: "Invalidate the current user's session",
        tags: [DOCS_TAGS.AUTHENTICATION],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Logout successful"),
            APIResponseSpec.unauthorized("Unauthorized: Invalid or missing session token / Your Auth Context is not a session"),
        )

    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        if (authContext.type !== 'session') {
            return APIResponse.unauthorized(c, "Your Auth Context is not a session");
        }

        await SessionHandler.inValidateSession(authContext.id);

        return APIResponse.successNoData(c, "Logout successful");
    }
);

router.route('/', resetPasswordRouter);