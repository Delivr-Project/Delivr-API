ALTER TABLE `mail_accounts` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_identities` ADD `is_default` integer DEFAULT false NOT NULL;