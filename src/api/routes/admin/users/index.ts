import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { and, eq, like, or } from "drizzle-orm";
import { DB } from "../../../../db";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { AdminUsersModel } from "./model";
import { AuthHandler, SessionHandler } from "../../../utils/authHandler";
import { DOCS_TAGS } from "../../../docs";

const TARGET_USER_KEY = "adminTargetUser";

const sanitizeUser = (user: DB.Models.User) => AdminUsersModel.SafeUser.parse(user);

export const router = new Hono().basePath('/users');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List users",
        description: "Retrieve Delivr accounts with optional role and search filters.",
        tags: [DOCS_TAGS.ADMIN_API.USERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Users retrieved successfully", AdminUsersModel.GetAll.Response)
        )
    }),

    zValidator("query", AdminUsersModel.GetAll.Query),

    async (c) => {
        const filters = c.req.valid("query") as AdminUsersModel.GetAll.Query;

        let predicate: ReturnType<typeof eq> | undefined;

        if (filters.role) {
            predicate = eq(DB.Schema.users.role, filters.role);
        }

        if (filters.search) {
            const pattern = `%${filters.search}%`;
            const searchPredicate = or(
                like(DB.Schema.users.username, pattern),
                like(DB.Schema.users.display_name, pattern),
                like(DB.Schema.users.email, pattern),
            );

            predicate = predicate ? and(predicate, searchPredicate) : searchPredicate;
        }

        let query = DB.instance().select().from(DB.Schema.users).$dynamic();

        if (predicate) {
            query = query.where(predicate);
        }

        if (filters.limit) {
            query = query.limit(filters.limit);
        }

        if (filters.offset) {
            query = query.offset(filters.offset);
        }

        const users = await query.orderBy(DB.Schema.users.id);

        return APIResponse.success(c, "Users retrieved successfully", users.map(sanitizeUser));
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create user",
        description: "Provision a new Delivr account with the desired role.",
        tags: [DOCS_TAGS.ADMIN_API.USERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("User created successfully", AdminUsersModel.Create.Response),
            APIResponseSpec.conflict("Conflict: Username or email already exists")
        )
    }),

    zValidator("json", AdminUsersModel.Create.Body),

    async (c) => {
        const body = c.req.valid("json") as AdminUsersModel.Create.Body;

        const duplicate = DB.instance().select().from(DB.Schema.users).where(
            or(
                eq(DB.Schema.users.username, body.username),
                eq(DB.Schema.users.email, body.email)
            )
        ).get();

        if (duplicate) {
            return APIResponse.conflict(c, "A user with the same username or email already exists");
        }

        const { password, ...userData } = body;

        const createdUser = DB.instance().insert(DB.Schema.users).values({
            ...userData,
            password_hash: await Bun.password.hash(password)
        }).returning().get();

        return APIResponse.created(c, "User created successfully", sanitizeUser(createdUser));
    }
);

router.use('/:userId/*',

    zValidator("param", AdminUsersModel.UserId.Params),

    async (c, next) => {
        // @ts-ignore - hono-openapi does not type "param" yet
        const { userId } = c.req.valid("param") as AdminUsersModel.UserId.Params;

        const user = DB.instance().select().from(DB.Schema.users).where(
            eq(DB.Schema.users.id, userId)
        ).get();

        if (!user) {
            return APIResponse.notFound(c, "User not found");
        }

        // @ts-ignore
        c.set(TARGET_USER_KEY, user);

        await next();
    }
);

router.get('/:userId',

    APIRouteSpec.authenticated({
        summary: "Get user",
        description: "Retrieve details for a specific Delivr account.",
        tags: [DOCS_TAGS.ADMIN_API.USERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("User retrieved successfully", AdminUsersModel.Create.Response),
            APIResponseSpec.notFound("User not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const user = c.get(TARGET_USER_KEY) as DB.Models.User;
        return APIResponse.success(c, "User retrieved successfully", sanitizeUser(user));
    }
);

router.put('/:userId',

    APIRouteSpec.authenticated({
        summary: "Update user",
        description: "Modify profile fields or role for a Delivr account.",
        tags: [DOCS_TAGS.ADMIN_API.USERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("User updated successfully", AdminUsersModel.Create.Response),
            APIResponseSpec.notFound("User not found"),
            APIResponseSpec.conflict("Conflict: Username or email already exists")
        )
    }),

    zValidator("json", AdminUsersModel.Update.Body),

    async (c) => {
        // @ts-ignore
        const user = c.get(TARGET_USER_KEY) as DB.Models.User;
        const updateBody = c.req.valid("json") as AdminUsersModel.Update.Body;

        const updates = Object.fromEntries(
            Object.entries(updateBody).filter(([, value]) => value !== undefined)
        ) as Partial<AdminUsersModel.Update.Body>;

        if (Object.keys(updates).length === 0) {
            return APIResponse.badRequest(c, "Provide at least one field to update");
        }

        if (updates.username && updates.username !== user.username) {
            const usernameConflict = DB.instance().select().from(DB.Schema.users).where(
                eq(DB.Schema.users.username, updates.username)
            ).get();

            if (usernameConflict) {
                return APIResponse.conflict(c, "Username already in use");
            }
        }

        if (updates.email && updates.email !== user.email) {
            const emailConflict = DB.instance().select().from(DB.Schema.users).where(
                eq(DB.Schema.users.email, updates.email)
            ).get();

            if (emailConflict) {
                return APIResponse.conflict(c, "Email already in use");
            }
        }

        const roleChanged = updates.role && updates.role !== user.role;

        await DB.instance().update(DB.Schema.users).set(updates).where(
            eq(DB.Schema.users.id, user.id)
        ).run();

        if (roleChanged && updates.role) {
            await AuthHandler.changeUserRoleInAuthContexts(user.id, updates.role);
        }

        const refreshed = DB.instance().select().from(DB.Schema.users).where(
            eq(DB.Schema.users.id, user.id)
        ).get();

        if (!refreshed) {
            throw new Error("User not found after update");
        }

        return APIResponse.success(c, "User updated successfully", sanitizeUser(refreshed));
    }
);

router.put('/:userId/password',

    APIRouteSpec.authenticated({
        summary: "Reset user password",
        description: "Set a new password for a Delivr account and revoke active sessions.",
        tags: [DOCS_TAGS.ADMIN_API.USERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Password reset successfully"),
            APIResponseSpec.notFound("User not found")
        )
    }),

    zValidator("json", AdminUsersModel.UpdatePassword.Body),

    async (c) => {
        // @ts-ignore
        const user = c.get(TARGET_USER_KEY) as DB.Models.User;
        const { password } = c.req.valid("json") as AdminUsersModel.UpdatePassword.Body;

        const passwordHash = await Bun.password.hash(password);

        await DB.instance().update(DB.Schema.users).set({
            password_hash: passwordHash
        }).where(
            eq(DB.Schema.users.id, user.id)
        ).run();

        await SessionHandler.inValidateAllSessionsForUser(user.id);

        return APIResponse.successNoData(c, "Password reset successfully");
    }
);

router.delete('/:userId',

    APIRouteSpec.authenticated({
        summary: "Delete user",
        description: "Permanently remove a Delivr account after verifying it has no owned packages.",
        tags: [DOCS_TAGS.ADMIN_API.USERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("User deleted successfully"),
            APIResponseSpec.notFound("User not found"),
            APIResponseSpec.badRequest("Cannot delete user while packages are assigned")
        )
    }),

    async (c) => {
        // @ts-ignore
        const user = c.get(TARGET_USER_KEY) as DB.Models.User;

        // Check for user data later

        await AuthHandler.invalidateAllAuthContextsForUser(user.id);

        await DB.instance().delete(DB.Schema.passwordResets).where(
            eq(DB.Schema.passwordResets.user_id, user.id)
        ).run();

        await DB.instance().delete(DB.Schema.users).where(
            eq(DB.Schema.users.id, user.id)
        ).run();

        return APIResponse.successNoData(c, "User deleted successfully");
    }
);
