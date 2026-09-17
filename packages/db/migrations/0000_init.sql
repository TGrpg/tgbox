CREATE TABLE `blacklist` (
	`type` text NOT NULL,
	`value` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`type`, `value`)
);
--> statement-breakpoint
CREATE TABLE `bot_drafts` (
	`tg_user_id` integer PRIMARY KEY NOT NULL,
	`step` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`name_zh` text NOT NULL,
	`name_en` text NOT NULL,
	`sort` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_kind_slug_unique` ON `categories` (`kind`,`slug`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`kind` text NOT NULL,
	`category_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`lang` text,
	`verified` integer DEFAULT false NOT NULL,
	`avatar_version` text,
	`tg_created_at` integer,
	`listed_at` integer NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`liveness` text DEFAULT 'active' NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`first_fail_at` integer,
	`last_fail_at` integer,
	`is_promoted` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_username_unique` ON `entries` (`username`);--> statement-breakpoint
CREATE TABLE `entry_stats` (
	`entry_id` integer PRIMARY KEY NOT NULL,
	`members` integer,
	`online` integer,
	`activity_tier` integer,
	`stats_written_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entry_tags` (
	`entry_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `tag_id`)
);
--> statement-breakpoint
CREATE TABLE `site_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` integer PRIMARY KEY NOT NULL,
	`tg_user_id` integer NOT NULL,
	`username` text NOT NULL,
	`kind` text NOT NULL,
	`category_id` integer NOT NULL,
	`tag_ids` text NOT NULL,
	`fetched_title` text,
	`fetched_description` text,
	`fetched_members` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`reject_reason` text,
	`reviewer_id` integer,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`admin_message_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_pending_username_unique` ON `submissions` (`username`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name_zh` text NOT NULL,
	`name_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);