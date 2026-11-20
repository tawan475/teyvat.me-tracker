CREATE TABLE `part_marks` (
	`account_id` integer NOT NULL,
	`part` text NOT NULL,
	`fingerprint` blob NOT NULL,
	`section_hash` blob NOT NULL,
	`blob_id` integer NOT NULL,
	`info` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `part`),
	FOREIGN KEY (`account_id`) REFERENCES `genshin_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
