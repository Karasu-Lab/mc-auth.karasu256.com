ALTER TABLE `mc_auth_session` ADD `skin` text;
--> statement-breakpoint
CREATE TABLE `mc_profile` (
	`mc_uuid` text PRIMARY KEY NOT NULL,
	`mc_name` text NOT NULL,
	`skin` text,
	`updated_at` integer NOT NULL
);
