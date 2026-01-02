import { eq } from "drizzle-orm";
import { DB } from "../../db";
import { randomBytes as crypto_randomBytes, createHash as crypto_createHash } from 'crypto';
import type { Context } from "hono";

export class AuthUtils {

    static async getUserRole(userID: number) {
        const user = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, userID)).get();
        if (!user) {
            return null;
        }
        return user.role;
    }

    static createRandomTokenID() {
        return crypto_randomBytes(32).toString('hex');
    }

    static createBaseToken() {
        return crypto_randomBytes(32).toString('hex');
    }

    static getFullToken(prefix: AuthHandler.TOKEN_PREFIX, tokenID: string, tokenBase: string) {
        return `${prefix}${tokenID}:${tokenBase}`;
    }

    static getTokenParts(fullToken: string) {
        const parts = fullToken.split(':') as [string, string];
        if (parts.length !== 2) {
            return null;
        }
        if (parts[0].startsWith(SessionHandler.SESSION_TOKEN_PREFIX)) {
            return {
                prefix: SessionHandler.SESSION_TOKEN_PREFIX,
                id: parts[0].substring(SessionHandler.SESSION_TOKEN_PREFIX.length),
                base: parts[1]
            } satisfies AuthHandler.TokenParts;
        } else if (parts[0].startsWith(APIKeyHandler.API_KEY_PREFIX)) {
            return {
                prefix: APIKeyHandler.API_KEY_PREFIX,
                id: parts[0].substring(APIKeyHandler.API_KEY_PREFIX.length),
                base: parts[1]
            } satisfies AuthHandler.TokenParts;
        } else {
            return null;
        }
    }

    static hashTokenBase(tokenBase: string) {
        return Bun.password.hash(tokenBase);
    }

    static verifyHashedTokenBase(tokenBase: string, hashedToken: string) {
        return Bun.password.verify(tokenBase, hashedToken);
    }

}

export class SessionHandler {

    static readonly SESSION_TOKEN_PREFIX = "dla_sess_";

    static async createSession(userID: number) {

        const tokenID = AuthUtils.createRandomTokenID();
        const tokenBase = AuthUtils.createBaseToken();

        const fullToken = AuthUtils.getFullToken(
            this.SESSION_TOKEN_PREFIX,
            tokenID,
            tokenBase
        );

        const result = await DB.instance().insert(DB.Schema.sessions).values({
            id: tokenID,
            hashed_token: await AuthUtils.hashTokenBase(tokenBase),
            user_id: userID,
            user_role: await AuthUtils.getUserRole(userID) || "user",
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).getTime() // 7 days from now
        }).returning().get();
        
        return {
            token: fullToken,
            user_id: result.user_id,
            user_role: result.user_role,
            created_at: result.created_at,
            expires_at: result.expires_at
        } satisfies Omit<DB.Models.Session, 'id' | 'hashed_token'> & { token: string; };
    }

    static async getSession(tokenParts: AuthHandler.TokenParts) {

        if (!tokenParts.prefix.startsWith(this.SESSION_TOKEN_PREFIX)) {
            return null;
        }

        const session = DB.instance().select().from(DB.Schema.sessions).where(
            eq(DB.Schema.sessions.id, tokenParts.id)
        ).get();
        if (!session) {
            return null;
        }

        if (!(await AuthUtils.verifyHashedTokenBase(tokenParts.base, session.hashed_token))) {
            return null;
        }

        return session;
    }

    static async isValidSession(session: DB.Models.Session) {
        if (!session) {
            return false;
        }

        if (session.expires_at < Date.now()) {
            // Delete expired session
            await DB.instance().delete(DB.Schema.sessions).where(eq(DB.Schema.sessions.id, session.id));

            return false;
        }

        return true;
    }
        
    static async inValidateAllSessionsForUser(userID: number) {
        await DB.instance().delete(DB.Schema.sessions).where(eq(DB.Schema.sessions.user_id, userID));
    }

    static async inValidateSession(tokenID: string) {
        await DB.instance().delete(DB.Schema.sessions).where(eq(DB.Schema.sessions.id, tokenID));
    }

    static async changeUserRoleInSessions(userID: number, newRole: "admin" | "user") {
        await DB.instance().update(DB.Schema.sessions).set({
            user_role: newRole
        }).where(
            eq(DB.Schema.sessions.user_id, userID)
        )
    }

}

export class APIKeyHandler {

    static readonly API_KEY_PREFIX = "dla_apikey_";

    static async createApiKey(userID: number, description: string, expiresInDays?: number) {
        const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).getTime() : null;

        const tokenID = AuthUtils.createRandomTokenID();
        const tokenBase = AuthUtils.createBaseToken();

        const fullToken = AuthUtils.getFullToken(
            this.API_KEY_PREFIX,
            tokenID,
            tokenBase
        );

        const result = await DB.instance().insert(DB.Schema.apiKeys).values({
            id: tokenID,
            hashed_token: await AuthUtils.hashTokenBase(tokenBase),
            user_id: userID,
            user_role: await AuthUtils.getUserRole(userID) || "user",
            description: description,
            expires_at: expiresAt
        }).returning().get();

        return {
            token: fullToken,
            user_id: result.user_id,
            user_role: result.user_role,
            created_at: result.created_at,
            expires_at: result.expires_at,
            description: result.description,
        } satisfies Omit<DB.Models.ApiKey, 'id' | 'hashed_token'> & { token: string; };
    }

    static async getApiKey(tokenParts: AuthHandler.TokenParts) {

        if (!tokenParts.prefix.startsWith(this.API_KEY_PREFIX)) {
            return null;
        }

        const key = DB.instance().select().from(DB.Schema.apiKeys).where(
            eq(DB.Schema.apiKeys.id, tokenParts.id)
        ).get();

        if (!key) {
            return null;
        }
        
        if (!(await AuthUtils.verifyHashedTokenBase(tokenParts.base, key.hashed_token))) {
            return null;
        }

        return key;
    }

    static async isValidApiKey(key: Omit<DB.Models.ApiKey, 'id'>) {
        if (!key) {
            return false;
        }

        if (key.expires_at && key.expires_at < Date.now()) {
            return false;
        }

        return true;
    }

    static async deleteAllApiKeysForUser(userID: number) {
        await DB.instance().delete(DB.Schema.apiKeys).where(eq(DB.Schema.apiKeys.user_id, userID));
    }

    static async deleteApiKey(apiKeyID: string) {
        await DB.instance().delete(DB.Schema.apiKeys).where(eq(DB.Schema.apiKeys.id, apiKeyID));
    }

    static async changeUserRoleInApiKeys(userID: number, newRole: "admin" | "user") {
        await DB.instance().update(DB.Schema.apiKeys).set({
            user_role: newRole
        }).where(
            eq(DB.Schema.apiKeys.user_id, userID)
        );
    }
}

export class AuthHandler {

    static async getTokenType(token: string) {
        if (token.startsWith(SessionHandler.SESSION_TOKEN_PREFIX)) {
            return 'session';
        } else if (token.startsWith(APIKeyHandler.API_KEY_PREFIX)) {
            return 'apiKey';
        } else {
            return 'unknown';
        }
    }

    static async getAuthContext(fullToken: string): Promise<AuthHandler.AuthContext | null> {

        const tokenParts = AuthUtils.getTokenParts(fullToken);
        if (!tokenParts) {
            return null;
        }

        switch (await this.getTokenType(fullToken)) {
            case 'session':

                const session = await SessionHandler.getSession(tokenParts);
                if (!session) {
                    return null;
                }
                return {
                    type: 'session' as const,
                    ...session
                }
            case 'apiKey':
                const apiKey = await APIKeyHandler.getApiKey(tokenParts);
                if (!apiKey) {
                    return null;
                }
                return {
                    type: 'apiKey' as const,
                    ...apiKey
                }
            default:
                return null;
        }

    }

    static async isValidAuthContext(authContext: AuthHandler.AuthContext): Promise<boolean> {
        switch (authContext.type) {
            case 'session':
                return await SessionHandler.isValidSession(authContext);
            case 'apiKey':
                return await APIKeyHandler.isValidApiKey(authContext);
            default:
                return false;
        }
    }

    static async invalidateAuthContext(authContext: AuthHandler.AuthContext): Promise<void> {
        switch (authContext.type) {
            case 'session':
                await SessionHandler.inValidateSession(authContext.id);
                break;
            case 'apiKey':
                await APIKeyHandler.deleteApiKey(authContext.id);
                break;
        }
    }

    static async invalidateAllAuthContextsForUser(userID: number): Promise<void> {
        return await Promise.all([
            SessionHandler.inValidateAllSessionsForUser(userID),
            APIKeyHandler.deleteAllApiKeysForUser(userID)
        ]).then(() => { return; });
    }

    static async changeUserRoleInAuthContexts(userID: number, newRole: "admin" | "user"): Promise<void> {
        return await Promise.all([
            SessionHandler.changeUserRoleInSessions(userID, newRole),
            APIKeyHandler.changeUserRoleInApiKeys(userID, newRole)
        ]).then(() => { return; });
    }

}

export namespace AuthHandler {

    export type TOKEN_PREFIX = typeof SessionHandler.SESSION_TOKEN_PREFIX | typeof APIKeyHandler.API_KEY_PREFIX;

    export type AuthContext = SessionAuthContext | ApiKeyAuthContext;

    export interface SessionAuthContext extends DB.Models.Session {
        readonly type: 'session';
    }

    export interface ApiKeyAuthContext extends DB.Models.ApiKey {
        readonly type: 'apiKey';
    }

    export interface TokenParts {
        readonly prefix: TOKEN_PREFIX;
        readonly id: string;
        readonly base: string;
    }

}

export namespace AuthHandler.AuthContext {

    export function get(c: Context): AuthHandler.AuthContext {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext | undefined;
        if (!authContext) {
            throw new Error("Auth context not set in context");
        }
        return authContext;
    }

    export function getAsSession(c: Context): AuthHandler.SessionAuthContext {
        return AuthHandler.AuthContext.get(c) as AuthHandler.SessionAuthContext;
    }

    export function getAsApiKey(c: Context): AuthHandler.ApiKeyAuthContext {
        return AuthHandler.AuthContext.get(c) as AuthHandler.ApiKeyAuthContext;
    }

    export function set(c: Context, authContext: AuthHandler.AuthContext) {
        return c.set("authContext", authContext);
    }

}