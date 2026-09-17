CREATE TABLE `hidden_posts` (
	`entry_id` integer NOT NULL,
	`post_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `post_id`)
);
--> statement-breakpoint
CREATE TABLE `support_threads` (
	`tg_user_id` integer PRIMARY KEY NOT NULL,
	`topic_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_threads_topic_unique` ON `support_threads` (`topic_id`);--> statement-breakpoint
CREATE TABLE `user_prefs` (
	`tg_user_id` integer PRIMARY KEY NOT NULL,
	`locale` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `entries` ADD `hide_posts` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Stars cash out at roughly 0.013 USD, so the seeded ⭐ prices were ~1.6x cheaper than the USDT
-- ones. Raise them to match. 0005 stays untouched (it is already applied): on a fresh install these
-- statements run right after the seed, so new databases get the corrected prices too. Only rows
-- still at the seeded value are touched, so an operator's own pricing is never overwritten.
UPDATE `products` SET `price_stars` = 800 WHERE `kind` = 'pin' AND `days` = 7 AND `price_stars` = 500;--> statement-breakpoint
UPDATE `products` SET `price_stars` = 2400 WHERE `kind` = 'pin' AND `days` = 30 AND `price_stars` = 1500;--> statement-breakpoint
UPDATE `products` SET `price_stars` = 1600 WHERE `kind` = 'banner' AND `days` = 7 AND `price_stars` = 1000;--> statement-breakpoint
UPDATE `products` SET `price_stars` = 4800 WHERE `kind` = 'banner' AND `days` = 30 AND `price_stars` = 3000;
