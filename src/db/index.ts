import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as TableSchema from './schema';
import { randomBytes as crypto_randomBytes } from 'crypto';
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
            await migrate(this.db, { migrationsFolder: "drizzle" });
            Logger.info("Database migrations completed.");
        }

        await this.createInitialAdminUserIfNeeded(configBaseDir);

        Logger.info(`Database initialized at ${path}`);
    }

    static async createInitialAdminUserIfNeeded(configBaseDir: string) {
        const usersTableEmpty = (await this.db.select().from(DB.Schema.users).limit(1)).length === 0;
        if (!usersTableEmpty) return;

        const username = "admin";

        const admin_user_id = await this.db.insert(DB.Schema.users).values({
            username,
            email: "admin@delivr.local",
            password_hash: await Bun.password.hash(crypto_randomBytes(32).toString('hex')),
            display_name: "Default Administrator",
            role: "admin"
        }).returning().get().id;

        const passwordResetToken = crypto_randomBytes(64).toString('hex');
        await this.db.insert(DB.Schema.passwordResets).values({
            token: passwordResetToken,
            user_id: admin_user_id,
            expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 Days
        });

        const DASHBOARD_URL = ConfigHandler.getConfig()?.DLA_APP_URL || "https://{DELIVR_APP_URL}";

        Bun.write(`${configBaseDir}/initial_admin_password_reset_token.txt`, `${DASHBOARD_URL}/auth/reset-password?token=${passwordResetToken}`, {
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
        await Bun.sleep(100);
    }

}


export namespace DB.Schema {
    export const users = TableSchema.users;
    export const sessions = TableSchema.sessions;
    export const passwordResets = TableSchema.passwordResets;
    export const apiKeys = TableSchema.apiKeys;
    
    export const mailAccounts = TableSchema.mailAccounts;
    export const mailIdentities = TableSchema.mailIdentities;

    export const metadata = TableSchema.metadata;
}

export namespace DB.Models {
    export type User = typeof DB.Schema.users.$inferSelect;
    export type Session = typeof DB.Schema.sessions.$inferSelect;
    export type PasswordReset = typeof DB.Schema.passwordResets.$inferSelect;
    export type ApiKey = typeof DB.Schema.apiKeys.$inferSelect;

    export type MailAccount = typeof DB.Schema.mailAccounts.$inferSelect;
    export type MailIdentity = typeof DB.Schema.mailIdentities.$inferSelect;

    export type Metadata = typeof DB.Schema.metadata.$inferSelect;
}