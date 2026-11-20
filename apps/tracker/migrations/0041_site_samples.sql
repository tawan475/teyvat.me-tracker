CREATE TABLE `site_samples` (
	`at` integer PRIMARY KEY NOT NULL,
	`users` integer DEFAULT 0 NOT NULL,
	`online` integer DEFAULT 0 NOT NULL,
	`capture` integer DEFAULT 0 NOT NULL,
	`in_game` integer DEFAULT 0 NOT NULL,
	`journals` integer DEFAULT 0 NOT NULL,
	`batches` integer DEFAULT 0 NOT NULL,
	`dau` integer DEFAULT 0 NOT NULL,
	`wau` integer DEFAULT 0 NOT NULL,
	`mau` integer DEFAULT 0 NOT NULL,
	`db_bytes` integer DEFAULT 0 NOT NULL,
	`live_bytes` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user_sessions` ADD `client` text;