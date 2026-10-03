import { eq } from "drizzle-orm";
import { DB } from "../../../db";
import type { DrizzleDB } from "../../../db/utils";

/**
 * Removes users and mail accounts together with every row that belongs to them.
 *
 * SQLite doesn't enforce the schema's foreign keys here, so anything left behind
 * would linger as orphaned data — including encrypted IMAP/SMTP credentials. Every
 * table that references a user or mail account must therefore be cleaned up here.
 *
 * Synchronous on purpose: the bun-sqlite driver commits a transaction as soon as its
 * callback returns, so an `async` callback commits at its first `await` and nothing
 * after it can be rolled back. Call these from a synchronous transaction callback,
 * `DB.instance().transaction((tx) => AccountDeletionService.deleteUser(id, tx))`, and
 * close the removed accounts' pooled IMAP connections with
 * `MailClientsCache.deleteClient` once it has committed.
 */
export class AccountDeletionService {

    static deleteMailAccount(mailAccountID: number, tx: DrizzleDB = DB.instance()): void {
        tx.delete(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.mail_account_id, mailAccountID)
        ).run();

        tx.delete(DB.Tables.mailAccountSpecialUse).where(
            eq(DB.Tables.mailAccountSpecialUse.mail_account_id, mailAccountID)
        ).run();

        tx.delete(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.id, mailAccountID)
        ).run();
    }

    /** @returns the IDs of the user's mail accounts that were removed with it. */
    static deleteUser(userID: number, tx: DrizzleDB = DB.instance()): number[] {
        const mailAccountIDs = tx.select({ id: DB.Tables.mailAccounts.id }).from(DB.Tables.mailAccounts).where(
            eq(DB.Tables.mailAccounts.owner_user_id, userID)
        ).all().map(account => account.id);

        for (const mailAccountID of mailAccountIDs) {
            this.deleteMailAccount(mailAccountID, tx);
        }

        tx.delete(DB.Tables.userPreferences).where(
            eq(DB.Tables.userPreferences.user_id, userID)
        ).run();

        tx.delete(DB.Tables.passwordResets).where(
            eq(DB.Tables.passwordResets.user_id, userID)
        ).run();

        tx.delete(DB.Tables.sessions).where(
            eq(DB.Tables.sessions.user_id, userID)
        ).run();

        tx.delete(DB.Tables.apiKeys).where(
            eq(DB.Tables.apiKeys.user_id, userID)
        ).run();

        tx.delete(DB.Tables.users).where(
            eq(DB.Tables.users.id, userID)
        ).run();

        return mailAccountIDs;
    }

}
