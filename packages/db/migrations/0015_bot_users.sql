CREATE TABLE `bot_users` (
	`tg_user_id` integer PRIMARY KEY NOT NULL,
	`first_name` text,
	`last_name` text,
	`username` text,
	`language_code` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_day` text NOT NULL,
	`blocked_at` integer
);
--> statement-breakpoint
CREATE TABLE `broadcasts` (
	`id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`button_text` text,
	`button_url` text,
	`audience` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL,
	`not_before` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
-- Users who reached the bot before it kept a user list; names fill in on their next update.
INSERT OR IGNORE INTO `bot_users` (`tg_user_id`, `first_seen_at`, `last_seen_day`)
SELECT `tg_user_id`, MIN(`t`), strftime('%Y-%m-%d', MAX(`t`) / 1000, 'unixepoch') FROM (
	SELECT `tg_user_id`, `created_at` AS `t` FROM `submissions`
	UNION ALL SELECT `tg_user_id`, `created_at` FROM `orders`
	UNION ALL SELECT `tg_user_id`, `updated_at` FROM `user_prefs`
	UNION ALL SELECT `tg_user_id`, `created_at` FROM `support_threads`
	UNION ALL SELECT `tg_user_id`, `updated_at` FROM `bot_drafts`
) GROUP BY `tg_user_id`;
