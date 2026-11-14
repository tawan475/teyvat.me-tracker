CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`secret_hash` text NOT NULL,
	`scopes` integer NOT NULL,
	`account_ids` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`last_ip` text,
	`last_country` text,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_tokens_user_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `api_tier` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `api_limits` text;