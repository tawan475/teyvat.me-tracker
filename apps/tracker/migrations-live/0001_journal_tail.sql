ALTER TABLE `live_journals` ADD `tail_from` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `live_journals` ADD `tail_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `live_journals` ADD `tail_changes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `live_journals` ADD `tail` blob;--> statement-breakpoint
ALTER TABLE `live_journals` ADD `points_day` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `live_journals` ADD `points` blob;