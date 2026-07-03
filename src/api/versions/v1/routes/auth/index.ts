import { Hono } from "hono";
import type { Context } from "hono";
import { AuthModel } from './model'
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler, SessionHandler } from "../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { router as resetPasswordRouter } from "./reset-password";
import { DOCS_TAGS } from "../../docs";

// Dummy bcrypt hash for timing-normalized login failures — prevents username enumeration
// Generated once at module load so it's a valid, cost-equivalent hash
const DUMMY_PASSWORD_HASH = await Bun.password.hash("dummy-timing-constant");

// Simple in-memory rate limiter for login to reduce brute-force risk
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_MAX_GLOBAL_ATTEMPTS = 15; // Per-username limit across all IPs
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const globalLoginAttempts = new Map<string, { count: number; resetAt: number }>();

// Periodic cleanup to prevent unbounded memory growth — runs every 5 minutes
const LOGIN_CLEANUP_INTERVAL = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of loginAttempts) {
        if (entry.resetAt <= now) loginAttempts.delete(key);
    }
    for (const [key, entry] of globalLoginAttempts) {
        if (entry.resetAt <= now) globalLoginAttempts.delete(key);
    }
}, LOGIN_WINDOW_MS);
// Allow the process to exit without waiting for this interval
LOGIN_CLEANUP_INTERVAL.unref();

function getClientId(c: Context) {
    // @ts-ignore bun/hono provides a native request with connection info
    const remote = (c.req.raw as any)?.remoteAddr?.hostname;
    return remote || "unknown";
}

function getLoginAttemptKey(clientId: string, username: string) {
    return `${clientId}:${username.toLowerCase()}`;
}

function getGlobalLoginAttemptKey(username: string) {
    return username.toLowerCase();
}

/**
 * Register a failed attempt, incrementing the counter atomically.
 * Returns the new count after increment — no await between read and write.
 */
function registerFailedLoginAttempt(loginAttemptKey: string, globalKey: string): { perIpCount: number; globalCount: number } {
    const now = Date.now();

    // Per-IP-per-username counter
    let entry = loginAttempts.get(loginAttemptKey);
    if (!entry || entry.resetAt <= now) {
        entry = { count: 1, resetAt: now + LOGIN_WINDOW_MS };
        loginAttempts.set(loginAttemptKey, entry);
    } else {
        entry.count += 1;
    }

    // Global per-username counter
    let globalEntry = globalLoginAttempts.get(globalKey);
    if (!globalEntry || globalEntry.resetAt <= now) {
        globalEntry = { count: 1, resetAt: now + LOGIN_WINDOW_MS };
        globalLoginAttempts.set(globalKey, globalEntry);
    } else {
        globalEntry.count += 1;
    }

    return { perIpCount: entry.count, globalCount: globalEntry.count };
}

function clearFailedLoginAttempts(loginAttemptKey: string, globalKey: string) {
    loginAttempts.delete(loginAttemptKey);
    globalLoginAttempts.delete(globalKey);
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

        //@ts-ignore
        const authContext = c.get("authContext") as AuthHandler.UnauthenticatedAuthContext;
        if (authContext.type !== 'unauthenticated') {
            return APIResponse.forbidden(c, "You are already authenticated");
        }


        const { username, password } = c.req.valid("json");

        const clientId = getClientId(c);
        const loginAttemptKey = getLoginAttemptKey(clientId, username);
        const globalKey = getGlobalLoginAttemptKey(username);

        // Increment counters FIRST, then check limits — eliminates TOCTOU race
        const { perIpCount, globalCount } = registerFailedLoginAttempt(loginAttemptKey, globalKey);

        if (perIpCount > LOGIN_MAX_ATTEMPTS || globalCount > LOGIN_MAX_GLOBAL_ATTEMPTS) {
            const retrySeconds = Math.max(1, Math.ceil(LOGIN_WINDOW_MS / 1000));
            c.header("Retry-After", retrySeconds.toString());
            return c.json({ success: false, code: 429, message: `Too many login attempts. Try again in ${retrySeconds}s` }, 429);
        }

        const user = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.username, username)).get();
        if (!user) {
            // Timing-normalized: always run a bcrypt call to prevent username enumeration
            await Bun.password.verify("dummy-timing-constant", DUMMY_PASSWORD_HASH);
            return APIResponse.unauthorized(c, "Invalid username or password");
        }

        const passwordMatch = await Bun.password.verify(password, user.password_hash);
        if (!passwordMatch) {
            return APIResponse.unauthorized(c, "Invalid username or password");
        }

        // Successful login — clear all counters for this user
        clearFailedLoginAttempts(loginAttemptKey, globalKey);

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

        const authContext = AuthHandler.AuthContext.get(c);
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

        const authContext = AuthHandler.AuthContext.get(c);

        if (authContext.type !== 'session') {
            return APIResponse.unauthorized(c, "Your Auth Context is not a session");
        }

        await SessionHandler.inValidateSession(authContext.id);

        return APIResponse.successNoData(c, "Logout successful");
    }
);

router.route('/', resetPasswordRouter);