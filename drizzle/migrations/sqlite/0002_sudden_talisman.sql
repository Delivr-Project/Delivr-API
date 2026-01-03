PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mail_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`smtp_host` text NOT NULL,
	`smtp_port` integer NOT NULL,
	`smtp_username` text NOT NULL,
	`smtp_password` text NOT NULL,
	`smtp_encryption` text NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`imap_username` text NOT NULL,
	`imap_password` text NOT NULL,
	`imap_encryption` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_mail_accounts`("id", "owner_user_id", "created_at", "smtp_host", "smtp_port", "smtp_username", "smtp_password", "smtp_encryption", "imap_host", "imap_port", "imap_username", "imap_password", "imap_encryption") SELECT "id", "owner_user_id", "created_at", "smtp_host", "smtp_port", "smtp_username", "smtp_password", "smtp_encryption", "imap_host", "imap_port", "imap_username", "imap_password", "imap_encryption" FROM `mail_accounts`;--> statement-breakpoint
DROP TABLE `mail_accounts`;--> statement-breakpoint
ALTER TABLE `__new_mail_accounts` RENAME TO `mail_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;