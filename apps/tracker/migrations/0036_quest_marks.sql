-- Quests marked done by hand (Collections → Archive → Quests). A new table:
-- nothing is rebuilt. Apply before deploying the code that reads it.
CREATE TABLE `quest_marks` (
	`account_id` integer NOT NULL,
	`quest_id` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `quest_id`),
	FOREIGN KEY (`account_id`) REFERENCES `genshin_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
