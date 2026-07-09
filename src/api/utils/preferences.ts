import { and, eq } from "drizzle-orm";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
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
        "auto-mark-seen": z.object({
            // Whether opening/viewing a mail automatically marks it as seen. Default on.
            enabled: z.boolean().default(true),
        }),
        "folder-nesting": z.object({
            // Whether the sidebar nests INBOX sub-folders under the Inbox item
            // instead of lifting them to top-level siblings. Default on.
            nestUnderInbox: z.boolean().default(true),
        }),
        "folder-dnd": z.object({
            // Whether folders can be reorganised by drag-and-drop in the sidebar.
            // Opt-in, so default off.
            enabled: z.boolean().default(false),
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
        key: T,
        tx: DrizzleDB = DB.instance()
    ): Promise<z.infer<(typeof UserPreferences.schemas)[T]>> {

        const record = await tx.select().from(DB.Tables.userPreferences).where(
            and(
                eq(DB.Tables.userPreferences.user_id, userID),
                eq(DB.Tables.userPreferences.key, key)
            )
        ).get();

        // Indexing the heterogeneous `schemas` record by the generic key widens the
        // parse result to a union, so narrow it back to this key's inferred type.
        type Parsed = z.infer<(typeof UserPreferences.schemas)[T]>;

        if (!record) {
            // schemas[key] has per-field (not top-level) defaults, so it must be
            // parsed against `{}` rather than `undefined` to fill them in.
            return UserPreferences.schemas[key].parse({}) as Parsed;
        }

        return UserPreferences.schemas[key].parse(record.data) as Parsed;
    }

    static async set<T extends UserPreferences.Key>(
        userID: number,
        key: T,
        data: z.infer<(typeof UserPreferences.schemas)[T]>,
        tx: DrizzleDB = DB.instance()
    ): Promise<void> {

        const parsed = UserPreferences.schemas[key].parse(data);

        await tx.insert(DB.Tables.userPreferences).values({
            user_id: userID,
            key,
            data: parsed
        }).onConflictDoUpdate({
            target: [DB.Tables.userPreferences.user_id, DB.Tables.userPreferences.key],
            set: { data: parsed }
        });
    }

    static async getRemoteContentPolicy(userID: number) {
        return this.get(userID, "remote-content-policy");
    }

    static async setRemoteContentPolicy(userID: number, data: z.infer<(typeof UserPreferences.schemas)["remote-content-policy"]>) {
        await this.set(userID, "remote-content-policy", data);
    }

    static async getAutoMarkSeen(userID: number) {
        return this.get(userID, "auto-mark-seen");
    }

    static async setAutoMarkSeen(userID: number, data: z.infer<(typeof UserPreferences.schemas)["auto-mark-seen"]>) {
        await this.set(userID, "auto-mark-seen", data);
    }

    static async getFolderNesting(userID: number) {
        return this.get(userID, "folder-nesting");
    }

    static async setFolderNesting(userID: number, data: z.infer<(typeof UserPreferences.schemas)["folder-nesting"]>) {
        await this.set(userID, "folder-nesting", data);
    }

    static async getFolderDnd(userID: number) {
        return this.get(userID, "folder-dnd");
    }

    static async setFolderDnd(userID: number, data: z.infer<(typeof UserPreferences.schemas)["folder-dnd"]>) {
        await this.set(userID, "folder-dnd", data);
    }

    static async deleteAllForUser(userID: number, tx: DrizzleDB = DB.instance()): Promise<void> {
        await tx.delete(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, userID)
        );
    }

}
