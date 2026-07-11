import {
    sqliteTable,
    integer,
    text,
    uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { SQLUtils } from '../utils';
import { UserAccountSettings } from '../../api/utils/shared-models/accountData';
import { InetModels } from '../../api/utils/shared-models/inetModels';

/**
 * @deprecated Use DB.Tables.users instead
 */
export const users = sqliteTable('users', {
    id: integer().primaryKey({ autoIncrement: true }),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),
    username: text().notNull().unique(),
    display_name: text().notNull(),
    email: text().notNull().unique(),
    password_hash: text().notNull(),
    role: text({
        enum: UserAccountSettings.Roles
    }).default("user").notNull()
});

/**
 * @deprecated Use DB.Tables.passwordResets instead
 */
export const passwordResets = sqliteTable('password_resets', {
    token: text().primaryKey(),
    user_id: integer().notNull().references(() => users.id),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),
    expires_at: integer().notNull()
});

/**
 * @deprecated Use DB.Tables.sessions instead
 */
export const sessions = sqliteTable('sessions', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: integer().notNull().references(() => users.id),
    user_role: text({
        enum: UserAccountSettings.Roles
    }).notNull().references(() => users.role),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),
    expires_at: integer().notNull()
});

/**
 * @deprecated Use DB.Tables.apiKeys instead
 */
export const apiKeys = sqliteTable('api_keys', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: integer().notNull().references(() => users.id),
    user_role: text({
        enum: UserAccountSettings.Roles
    }).notNull().references(() => users.role),
    description: text().notNull(),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),
    expires_at: integer(),
});


/**
 * @deprecated Use DB.Tables.mailAccounts instead
 */
export const mailAccounts = sqliteTable('mail_accounts', {
    id: integer().primaryKey({ autoIncrement: true }),
    owner_user_id: integer().notNull().references(() => users.id),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),

    display_name: text().notNull(),

    // smtp_host: text().notNull(),
    // smtp_port: integer().notNull(),
    // smtp_username: text().notNull(),
    // smtp_password: text().notNull(),
    // smtp_encryption: text({
    //     enum: InetModels.Mail.EncryptionTypes
    // }).notNull(),
    
    // imap_host: text().notNull(),
    // imap_port: integer().notNull(),
    // imap_username: text().notNull(),
    // imap_password: text().notNull(),
    // imap_encryption: text({
    //     enum: InetModels.Mail.EncryptionTypes
    // }).notNull(),

    smtp_encrypted_connection_data: text().notNull(),
    imap_encrypted_connection_data: text().notNull(),

    // is this the default mail account for the user
    is_default: integer({ mode: "boolean" }).notNull().default(false),

    // Whether the user has finished the one-time, per-account folder onboarding
    // (mirrors the platform-wide `onboarding` user preference, but scoped to this
    // mail account). Defaults false until the user finishes or skips it.
    onboarding_finished: integer({ mode: "boolean" }).notNull().default(false)
});

/**
 * @deprecated Use DB.Tables.mailIdentities instead
 */
export const mailIdentities = sqliteTable('mail_identities', {
    id: integer().primaryKey({ autoIncrement: true }),
    mail_account_id: integer().notNull().references(() => mailAccounts.id),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),
    
    display_name: text().notNull(),
    email_address: text().notNull(),

    // is this the default identity for the mail account
    is_default: integer({ mode: "boolean" }).notNull().default(false)
});

/**
 * @deprecated Use DB.Tables.metadata instead
 */
export const metadata = sqliteTable('metadata', {
    key: text().primaryKey(),
    data: text({ mode: 'json' }).$type<Record<string, any> | Array<any>>().notNull()
});

/**
 * @deprecated Use DB.Tables.userPreferences instead
 */
export const userPreferences = sqliteTable('user_preferences', {
    id: integer().primaryKey({ autoIncrement: true }),
    user_id: integer().notNull().references(() => users.id),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),

    // Preference key, e.g. "remote-content-policy".
    key: text().notNull(),
    data: text({ mode: 'json' }).$type<Record<string, any> | Array<any>>().notNull()
}, (table) => [
    uniqueIndex('user_preferences_user_id_key_unique').on(table.user_id, table.key)
]);

/**
 * Persisted special-use folder mapping per mail account. The backend detects
 * these once (IMAP \\Flag → name heuristic) and stores the result so neither it
 * nor the client re-guesses on every request; users can override individual
 * entries. One row per account; `data` is `{ [type]: { path, source } }`.
 */
export const mailAccountSpecialUse = sqliteTable('mail_account_special_use', {
    id: integer().primaryKey({ autoIncrement: true }),
    mail_account_id: integer().notNull().references(() => mailAccounts.id),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),

    data: text({ mode: 'json' }).$type<Record<string, { path: string; source: 'flag' | 'guess' | 'user' }>>().notNull()
}, (table) => [
    uniqueIndex('mail_account_special_use_account_unique').on(table.mail_account_id)
]);
