CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`started_at` integer NOT NULL,
	`took_ms` integer DEFAULT 0 NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_runs_started_idx` ON `job_runs` (`started_at`);--> statement-breakpoint
ALTER TABLE `site_samples` ADD `cf_requests` integer;--> statement-breakpoint
ALTER TABLE `site_samples` ADD `cf_errors` integer;--> statement-breakpoint
ALTER TABLE `site_samples` ADD `cf_cpu_ms` integer;--> statement-breakpoint
ALTER TABLE `site_samples` ADD `cf_4xx` integer;--> statement-breakpoint
ALTER TABLE `site_samples` ADD `cf_429` integer;--> statement-breakpoint
ALTER TABLE `site_samples` ADD `cf_5xx` integer;--> statement-breakpoint
ALTER TABLE `user_sessions` ADD `client_version` text;--> statement-breakpoint
ALTER TABLE `user_sessions` ADD `client_platform` text;--> statement-breakpoint
ALTER TABLE `user_sessions` ADD `client_version_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `from_guest` integer DEFAULT false NOT NULL;