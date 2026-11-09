-- Time travel (docs/plans/time-travel.md §8): every version of what the
-- player sets by hand, so the past shows the plan and marks of its time.
-- A new table and its seed rows: nothing is rebuilt. Recording starts now,
-- with every goal and mark there is (site_settings `history.since`).
CREATE TABLE `progress_history` (
	`account_id` integer NOT NULL,
	`area` text NOT NULL,
	`item` text NOT NULL,
	`value` text,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	FOREIGN KEY (`account_id`) REFERENCES `genshin_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `progress_history_open_idx` ON `progress_history` (`account_id`,`area`,`item`) WHERE "progress_history"."valid_to" is null;--> statement-breakpoint
CREATE INDEX `progress_history_at_idx` ON `progress_history` (`account_id`,`area`,`valid_from`);
--> statement-breakpoint
INSERT INTO `progress_history` (`account_id`, `area`, `item`, `value`, `valid_from`)
SELECT `account_id`, 'target', `kind` || char(31) || `key` || char(31) || `owner`,
  json_object('kind', `kind`, 'key', `key`, 'owner', `owner`, 'target', json(`target`),
    'current', json(`current`)),
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `planner_targets`;--> statement-breakpoint
INSERT INTO `progress_history` (`account_id`, `area`, `item`, `value`, `valid_from`)
SELECT `account_id`, 'weapon', `id`,
  json_object('id', `id`, 'key', `key`, 'owner', `owner`, 'n', `rowid`, 'target', json(`target`),
    'current', json(`current`)),
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `planner_weapon_goals`;--> statement-breakpoint
INSERT INTO `progress_history` (`account_id`, `area`, `item`, `value`, `valid_from`)
SELECT `account_id`, 'achievement', CAST(`achievement_id` AS TEXT), NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM `achievement_marks`;--> statement-breakpoint
INSERT INTO `progress_history` (`account_id`, `area`, `item`, `value`, `valid_from`)
SELECT `account_id`, 'anecdote', CAST(`anecdote_id` AS TEXT), NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM `anecdote_marks`;--> statement-breakpoint
INSERT INTO `progress_history` (`account_id`, `area`, `item`, `value`, `valid_from`)
SELECT `account_id`, 'quest', CAST(`quest_id` AS TEXT), NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM `quest_marks`;--> statement-breakpoint
INSERT INTO `site_settings` (`key`, `value`, `updated_at`)
VALUES ('history.since', CAST(CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS TEXT), CAST(strftime('%s', 'now') AS INTEGER) * 1000);
