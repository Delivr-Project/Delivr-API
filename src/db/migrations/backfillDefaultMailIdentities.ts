import { z } from "zod";
import * as TableSchema from "../schema/sqlite";
import type { DrizzleDatabase } from "../utils";
import { MailAccountEncryption } from "../../utils/crypto/mailCrypt";
import { Logger } from "../../utils/logger";

const EMAIL = z.email();

export namespace MailIdentitiesBackfill {

    export type Result = {
        /** Accounts that were given a default identity by this run. */
        created: number;
        /** Accounts left without one because no address could be derived. */
        skipped: number;
    };

}

/**
 * Data migration: every mail account must have at least one sender identity.
 *
 * Accounts created before identities were mandatory have none, so this gives
 * each of them a default identity built from its own SMTP username, with the
 * display name set to that same address.
 *
 * This can't be a plain SQL migration: the SMTP username lives inside the
 * account's encrypted connection blob, so deriving it needs the encryption key
 * — hence {@link MailAccountEncryption} must be initialised before this runs.
 *
 * Idempotent: accounts that already have an identity are never touched, so a
 * repeated run is a no-op. An account whose SMTP username isn't an email
 * address is skipped with a warning rather than given a bogus sender.
 */
export async function backfillDefaultMailIdentities(db: DrizzleDatabase): Promise<MailIdentitiesBackfill.Result> {

    const accounts = await db.select({
        id: TableSchema.mailAccounts.id,
        smtp_encrypted_connection_data: TableSchema.mailAccounts.smtp_encrypted_connection_data
    }).from(TableSchema.mailAccounts);

    if (accounts.length === 0) return { created: 0, skipped: 0 };

    const accountIDsWithIdentity = new Set(
        (await db.select({
            mail_account_id: TableSchema.mailIdentities.mail_account_id
        }).from(TableSchema.mailIdentities)).map((row) => row.mail_account_id)
    );

    const pending = accounts.filter((account) => !accountIDsWithIdentity.has(account.id));
    if (pending.length === 0) return { created: 0, skipped: 0 };

    const values: (typeof TableSchema.mailIdentities.$inferInsert)[] = [];
    let skipped = 0;

    for (const account of pending) {

        const smtpData = MailAccountEncryption.decryptSMTPData(account.smtp_encrypted_connection_data);
        const emailAddress = smtpData?.username?.trim();

        if (!emailAddress || !EMAIL.safeParse(emailAddress).success) {
            Logger.warn(
                `Mail account ${account.id} has no sender identity and its SMTP username is not an email address — ` +
                `add one manually before sending from this account.`
            );
            skipped++;
            continue;
        }

        values.push({
            mail_account_id: account.id,
            display_name: emailAddress,
            email_address: emailAddress,
            is_default: true
        });
    }

    if (values.length > 0) {
        await db.insert(TableSchema.mailIdentities).values(values);
        Logger.info(`Created a default sender identity for ${values.length} mail account(s).`);
    }

    return { created: values.length, skipped };
}
