import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { int } from 'drizzle-orm/sqlite-core';

export type DrizzleDB = ReturnType<typeof drizzle>;

export namespace SQLUtils {

    export function getCreatedAtColumn() {
        // return int("created_at", { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`);
        return int("created_at", { mode: 'number' }).notNull().default(sql`(unixepoch() * 1000)`);
    }

}