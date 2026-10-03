-- `DELETE /admin/users/:userId` used to remove only the user row, its sessions,
-- API keys and password resets. SQLite doesn't enforce the schema's foreign
-- keys, so the user's mail accounts — including their encrypted IMAP/SMTP
-- credentials — identities, special-use mappings and preferences stayed behind,
-- unreachable through the API. Remove them.
--
-- Only rows whose owner no longer exists match, so a repeated run is a no-op.
-- Dependents of a mail account go first, while the account still tells us whose
-- it was.
DELETE FROM `mail_identities`
WHERE `mail_account_id` NOT IN (
    SELECT `id` FROM `mail_accounts` WHERE `owner_user_id` IN (SELECT `id` FROM `users`)
);
--> statement-breakpoint
DELETE FROM `mail_account_special_use`
WHERE `mail_account_id` NOT IN (
    SELECT `id` FROM `mail_accounts` WHERE `owner_user_id` IN (SELECT `id` FROM `users`)
);
--> statement-breakpoint
DELETE FROM `mail_accounts` WHERE `owner_user_id` NOT IN (SELECT `id` FROM `users`);
--> statement-breakpoint
DELETE FROM `user_preferences` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);
--> statement-breakpoint
DELETE FROM `sessions` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);
--> statement-breakpoint
DELETE FROM `api_keys` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);
--> statement-breakpoint
DELETE FROM `password_resets` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);
