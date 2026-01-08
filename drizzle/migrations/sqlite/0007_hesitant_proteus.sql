ALTER TABLE `mail_accounts` ADD `smtp_encrypted_connection_data` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `imap_encrypted_connection_data` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `smtp_host`;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `smtp_port`;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `smtp_username`;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `smtp_password`;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `smtp_encryption`;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `imap_host`;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `imap_port`;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `imap_username`;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `imap_password`;--> statement-breakpoint
ALTER TABLE `mail_accounts` DROP COLUMN `imap_encryption`;