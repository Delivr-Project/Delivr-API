PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mail_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`display_name` text NOT NULL,
	`smtp_encrypted_connection_data` text NOT NULL,
	`imap_encrypted_connection_data` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_mail_accounts`("id", "owner_user_id", "created_at", "display_name", "smtp_encrypted_connection_data", "imap_encrypted_connection_data", "is_default") SELECT "id", "owner_user_id", "created_at", "display_name", "smtp_encrypted_connection_data", "imap_encrypted_connection_data", "is_default" FROM `mail_accounts`;--> statement-breakpoint
DROP TABLE `mail_accounts`;--> statement-breakpoint
ALTER TABLE `__new_mail_accounts` RENAME TO `mail_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;