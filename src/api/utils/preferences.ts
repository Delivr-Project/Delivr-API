import { and, eq } from "drizzle-orm";
import { DB } from "../../db";
import { z } from "zod";

const RemoteContentDecision = z.enum(["allow", "block"]);

export namespace UserPreferences {

    export const schemas = {
        "remote-content-policy": z.object({
            // Full sender address (lowercase) -> decision. Takes precedence over domain.
            addresses: z.record(z.string(), RemoteContentDecision).default({}),
            // Sender domain (lowercase, e.g. "example.com") -> decision.
            domains: z.record(z.string(), RemoteContentDecision).default({}),
        }),
    } as const;

    export type Key = keyof typeof schemas;

}

/**
 * Per-user key/value preference storage (e.g. remote email content policy),
 * mirroring `RuntimeMetadata` but scoped to `user_id` instead of being global.
 * Each key has a fixed zod schema so clients cannot store arbitrary data.
 */
export class UserPreferencesHandler {

    static async get<T extends UserPreferences.Key>(
        userID: number,
        key: T
    ): Promise<z.infer<(typeof UserPreferences.schemas)[T]>> {

        const record = await DB.instance().select().from(DB.Schema.userPreferences).where(
            and(
                eq(DB.Schema.userPreferences.user_id, userID),
                eq(DB.Schema.userPreferences.key, key)
            )
        ).get();

        if (!record) {
            return UserPreferences.schemas[key].parse(undefined);
        }

        return UserPreferences.schemas[key].parse(record.data);
    }

    static async set<T extends UserPreferences.Key>(
        userID: number,
        key: T,
        data: z.infer<(typeof UserPreferences.schemas)[T]>
    ): Promise<void> {

        const parsed = UserPreferences.schemas[key].parse(data);

        const existing = await DB.instance().select({ id: DB.Schema.userPreferences.id }).from(DB.Schema.userPreferences).where(
            and(
                eq(DB.Schema.userPreferences.user_id, userID),
                eq(DB.Schema.userPreferences.key, key)
            )
        ).get();

        if (existing) {
            await DB.instance().update(DB.Schema.userPreferences).set({
                data: parsed
            }).where(
                eq(DB.Schema.userPreferences.id, existing.id)
            );
        } else {
            await DB.instance().insert(DB.Schema.userPreferences).values({
                user_id: userID,
                key,
                data: parsed
            });
        }
    }

    static async getRemoteContentPolicy(userID: number) {
        return this.get(userID, "remote-content-policy");
    }

    static async setRemoteContentPolicy(userID: number, data: z.infer<(typeof UserPreferences.schemas)["remote-content-policy"]>) {
        await this.set(userID, "remote-content-policy", data);
    }

    static async deleteAllForUser(userID: number): Promise<void> {
        await DB.instance().delete(DB.Schema.userPreferences).where(
            eq(DB.Schema.userPreferences.user_id, userID)
        );
    }

}
