import type { TaskHandler } from '@cleverjs/utils';
import { desc, sql } from 'drizzle-orm';
import {
    sqliteTable,
    int,
    text
} from 'drizzle-orm/sqlite-core';
import { SQLUtils } from './utils';
import { UserAccountSettings } from '../api/utils/shared-models/accountData';
import { InetModels } from '../api/utils/shared-models/inetModels';

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
        enum: UserAccountSettings.Roles
    }).default("user").notNull()
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
        enum: UserAccountSettings.Roles
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
        enum: UserAccountSettings.Roles
    }).notNull().references(() => users.role),
    description: text().notNull(),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: int(),
});


/**
 * @deprecated Use DB.Schema.mailAccounts instead
 */
export const mailAccounts = sqliteTable('mail_accounts', {
    id: int().primaryKey({ autoIncrement: true }),
    owner_user_id: int().notNull().references(() => users.id),
    created_at: SQLUtils.getCreatedAtColumn(),

    smtp_host: text().notNull(),
    smtp_port: int().notNull(),
    smtp_username: text().notNull(),
    smtp_password: text().notNull(),
    smtp_encryption: text({
        enum: InetModels.Mail.EncryptionTypes
    }).notNull(),
    
    imap_host: text().notNull(),
    imap_port: int().notNull(),
    imap_username: text().notNull(),
    imap_password: text().notNull(),
    imap_encryption: text({
        enum: InetModels.Mail.EncryptionTypes
    }).notNull()
});


/**
 * @deprecated Use DB.Schema.metadata instead
 */
export const metadata = sqliteTable('metadata', {
    key: text().primaryKey(),
    data: text({ mode: 'json' }).$type<Record<string, any> | Array<any>>().notNull()
});
