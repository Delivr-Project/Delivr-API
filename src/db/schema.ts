import type { TaskHandler } from '@cleverjs/utils';
import { desc, sql } from 'drizzle-orm';
import {
    sqliteTable,
    int,
    text
} from 'drizzle-orm/sqlite-core';
import { SQLUtils } from './utils';

/**
 * @deprecated Use DB.Schema.users instead
 */
export const users = sqliteTable('users', {
    id: int().primaryKey({ autoIncrement: true }),
    created_at: SQLUtils.getCreatedAtColumn(),
    username: text().notNull().unique(),
    display_name: text().notNull(),
    email: text().notNull().unique(),
    password_hash: text().notNull(),
    role: text({
        enum: ['admin', 'developer', 'user']
    }).default('user').notNull()
});

/**
 * @deprecated Use DB.Schema.passwordResets instead
 */
export const passwordResets = sqliteTable('password_resets', {
    token: text().primaryKey(),
    user_id: int().notNull().references(() => users.id),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: int().notNull()
});

/**
 * @deprecated Use DB.Schema.sessions instead
 */
export const sessions = sqliteTable('sessions', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: int().notNull().references(() => users.id),
    user_role: text({
        enum: ['admin', 'developer', 'user']
    }).notNull().references(() => users.role),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: int().notNull()
});

/**
 * @deprecated Use DB.Schema.apiKeys instead
 */
export const apiKeys = sqliteTable('api_keys', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: int().notNull().references(() => users.id),
    user_role: text({
        enum: ['admin', 'developer', 'user']
    }).notNull().references(() => users.role),
    description: text().notNull(),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: int(),
});


/**
 * @deprecated Use DB.Schema.tmp_data instead
 */
export const metadata = sqliteTable('metadata', {
    key: text().primaryKey(),
    data: text({ mode: 'json' }).$type<Record<string, any> | Array<any>>().notNull()
});

