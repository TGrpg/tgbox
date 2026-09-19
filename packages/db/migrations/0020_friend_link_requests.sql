CREATE TABLE `friend_link_requests` (
	`id` integer PRIMARY KEY NOT NULL,
	`tg_user_id` integer NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`backlink` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_link_requests_pending_user_unique` ON `friend_link_requests` (`tg_user_id`) WHERE status = 'pending';