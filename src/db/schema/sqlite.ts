import {
    sqliteTable,
    integer,
    text
} from 'drizzle-orm/sqlite-core';
import { SQLUtils } from '../utils';
import { UserAccountSettings } from '../../api/utils/shared-models/accountData';
import { InetModels } from '../../api/utils/shared-models/inetModels';

/**
 * @deprecated Use DB.Schema.users instead
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
 * @deprecated Use DB.Schema.passwordResets instead
 */
export const passwordResets = sqliteTable('password_resets', {
    token: text().primaryKey(),
    user_id: integer().notNull().references(() => users.id),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),
    expires_at: integer().notNull()
});

/**
 * @deprecated Use DB.Schema.sessions instead
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
 * @deprecated Use DB.Schema.apiKeys instead
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
 * @deprecated Use DB.Schema.mailAccounts instead
 */
export const mailAccounts = sqliteTable('mail_accounts', {
    id: integer().primaryKey({ autoIncrement: true }),
    owner_user_id: integer().notNull().references(() => users.id),
    created_at: SQLUtils.getCreatedAtColumn("sqlite"),

    display_name: text().notNull(),

    smtp_host: text().notNull(),
    smtp_port: integer().notNull(),
    smtp_username: text().notNull(),
    smtp_password: text().notNull(),
    smtp_encryption: text({
        enum: InetModels.Mail.EncryptionTypes
    }).notNull(),
    
    imap_host: text().notNull(),
    imap_port: integer().notNull(),
    imap_username: text().notNull(),
    imap_password: text().notNull(),
    imap_encryption: text({
        enum: InetModels.Mail.EncryptionTypes
    }).notNull(),

    // is this the default mail account for the user
    is_default: integer({ mode: "boolean" }).notNull().default(false)
});

/**
 * @deprecated Use DB.Schema.mailIdentities instead
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
 * @deprecated Use DB.Schema.metadata instead
 */
export const metadata = sqliteTable('metadata', {
    key: text().primaryKey(),
    data: text({ mode: 'json' }).$type<Record<string, any> | Array<any>>().notNull()
});
