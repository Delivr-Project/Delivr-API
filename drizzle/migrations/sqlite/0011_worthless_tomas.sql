CREATE TABLE `mail_account_special_use` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mail_account_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`mail_account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_account_special_use_account_unique` ON `mail_account_special_use` (`mail_account_id`);