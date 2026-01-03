CREATE TABLE `mail_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mail_account_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`display_name` text NOT NULL,
	`email_address` text NOT NULL,
	FOREIGN KEY (`mail_account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
