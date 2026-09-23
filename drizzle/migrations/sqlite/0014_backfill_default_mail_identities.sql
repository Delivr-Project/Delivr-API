-- Give every mail account that predates mandatory identities one, so no account
-- is left without an address to send from. Accounts that already have an
-- identity are not touched, which also makes a repeated run a no-op.
--
-- The mailbox address itself is not reachable from SQL: it lives inside
-- `mail_accounts.smtp_encrypted_connection_data`, encrypted with the app's
-- `DLA_ENCRYPTION_KEY`. The owner's Delivr account email is the only address
-- this migration can see, so that is what the identity is named and addressed
-- after — correct it under the account's Identities settings where the two
-- differ.
--
-- It is deliberately not the default identity: the composer lists the account's
-- own (decrypted) SMTP address first, so a backfilled address that turns out to
-- be wrong is never preselected for sending.
INSERT INTO `mail_identities` (`mail_account_id`, `display_name`, `email_address`, `is_default`)
SELECT `mail_accounts`.`id`, `users`.`email`, `users`.`email`, 0
FROM `mail_accounts`
INNER JOIN `users` ON `users`.`id` = `mail_accounts`.`owner_user_id`
WHERE NOT EXISTS (
    SELECT 1 FROM `mail_identities`
    WHERE `mail_identities`.`mail_account_id` = `mail_accounts`.`id`
);
