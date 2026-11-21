CREATE TABLE `mc_auth_session` (
	`id` text PRIMARY KEY NOT NULL,
	`mc_uuid` text NOT NULL,
	`mc_name` text NOT NULL,
	`raw_code` text,
	`code_hash` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mc_online_player` (
	`mc_uuid` text PRIMARY KEY NOT NULL,
	`mc_name` text NOT NULL,
	`joined_at` integer NOT NULL
);
