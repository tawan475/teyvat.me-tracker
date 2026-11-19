-- Issue 12: the build sections Capture's gi_off left out, as bits (0 = all shared).
ALTER TABLE `snapshots` ADD `off_sections` integer DEFAULT 0 NOT NULL;
