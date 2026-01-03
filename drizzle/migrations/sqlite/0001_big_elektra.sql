CREATE TABLE `mail_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`smtp_host` text NOT NULL,
	`smtp_port` integer NOT NULL,
	`smtp_username` text NOT NULL,
	`smtp_password` text NOT NULL,
	`smtp_encryption` text DEFAULT 'NONE' NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`imap_username` text NOT NULL,
	`imap_password` text NOT NULL,
	`imap_encryption` text DEFAULT 'NONE' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_accounts_smtp_host_unique` ON `mail_accounts` (`smtp_host`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail_accounts_imap_host_unique` ON `mail_accounts` (`imap_host`);