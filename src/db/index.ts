import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as TableSchema from './schema/sqlite';
import { randomBytes as crypto_randomBytes, createHash as crypto_createHash } from 'crypto';
import { type DrizzleDB } from './utils';
import { Logger } from '../utils/logger';
import { ConfigHandler } from '../utils/config';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdir as fs_mkdir } from 'fs/promises';
import { dirname as path_dirname } from 'path';

export class DB {

    protected static db: DrizzleDB;

    static async init(
        path: string,
        autoMigrate: boolean = false,
        configBaseDir: string
    ) {

        await fs_mkdir(path_dirname(path), { recursive: true });

        this.db = drizzle(path);
        if (autoMigrate) {
            Logger.info("Running database migrations...");
            await migrate(this.db, { migrationsFolder: "drizzle/migrations/sqlite" });
            Logger.info("Database migrations completed.");
        }

        await this.createInitialAdminUserIfNeeded(configBaseDir);

        Logger.info(`Database initialized at ${path}`);
    }

    static async createInitialAdminUserIfNeeded(configBaseDir: string) {
        const usersTableEmpty = (await this.db.select().from(DB.Tables.users).limit(1)).length === 0;
        if (!usersTableEmpty) return;

        const username = "admin";

        const admin_user_id = await this.db.insert(DB.Tables.users).values({
            username,
            email: "admin@delivr.local",
            password_hash: await Bun.password.hash(crypto_randomBytes(32).toString('hex')),
            display_name: "Default Administrator",
            role: "admin"
        }).returning().get().id;

        const passwordResetToken = crypto_randomBytes(64).toString('hex');
        await this.db.insert(DB.Tables.passwordResets).values({
            token: crypto_createHash('sha256').update(passwordResetToken).digest('hex'),
            user_id: admin_user_id,
            expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 Days
        });

        const DASHBOARD_URL = ConfigHandler.getConfig()?.DLA_APP_URL || "https://{DELIVR_APP_URL}";

        await Bun.write(`${configBaseDir}/initial_admin_password_reset_token.txt`, `${DASHBOARD_URL}/auth/reset-password?token=${passwordResetToken}`, {
            mode: 0o600,
            createPath: true
        });

        Logger.info(
            `Initial admin user created with username: ${username}.\n` +
            `You can set the password under ${DASHBOARD_URL}/auth/reset-password?token=${passwordResetToken}\n` +
            `The url is also safed at ${configBaseDir}/initial_admin_password_reset_token.txt\n`
        );
    }

    static instance() {
        if (!this.db) {
            throw new Error('Database not initialized. Call DB.init() first.');
        }
        return DB.db;
    }

    static async close() {
        if (!this.db) return;

        Logger.info("Database connection closed.");
        this.db.$client.close();

        // `close()` calls sqlite3_close_v2, which defers releasing the OS file
        // handle until any unfinalized prepared statements are garbage collected.
        // Force that now so the underlying file is actually free (e.g. for tests
        // that remove the DB file/directory right after closing).
        Bun.gc(true);
        await Bun.sleep(100);
    }

}


export namespace DB.Tables {
    export const users = TableSchema.users;
    export const sessions = TableSchema.sessions;
    export const passwordResets = TableSchema.passwordResets;
    export const apiKeys = TableSchema.apiKeys;
    
    export const mailAccounts = TableSchema.mailAccounts;
    export const mailIdentities = TableSchema.mailIdentities;

    export const metadata = TableSchema.metadata;
    export const userPreferences = TableSchema.userPreferences;
    export const mailAccountSpecialUse = TableSchema.mailAccountSpecialUse;
}

export namespace DB.Models {
    export type User = typeof DB.Tables.users.$inferSelect;
    export type Session = typeof DB.Tables.sessions.$inferSelect;
    export type PasswordReset = typeof DB.Tables.passwordResets.$inferSelect;
    export type ApiKey = typeof DB.Tables.apiKeys.$inferSelect;

    export type MailAccount = typeof DB.Tables.mailAccounts.$inferSelect;
    export type MailIdentity = typeof DB.Tables.mailIdentities.$inferSelect;

    export type Metadata = typeof DB.Tables.metadata.$inferSelect;
    export type UserPreference = typeof DB.Tables.userPreferences.$inferSelect;
}