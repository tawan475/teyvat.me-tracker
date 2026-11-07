-- Passkeys (WebAuthn): one more way in beside a password, Discord and Google,
-- and the challenges already answered (each works once). New tables only:
-- nothing is rebuilt. Apply before deploying the code that reads them.
CREATE TABLE `passkey_challenges` (
	`challenge_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`algorithm` integer NOT NULL,
	`sign_count` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`aaguid` text,
	`user_handle` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_id_unique` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE INDEX `passkeys_user_idx` ON `passkeys` (`user_id`);