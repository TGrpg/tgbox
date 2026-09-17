CREATE TABLE `bot_chats` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`username` text,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`key` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY NOT NULL,
	`tg_user_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`kind` text NOT NULL,
	`days` integer NOT NULL,
	`target_username` text,
	`banner` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text,
	`amount` text,
	`currency` text,
	`invoice_id` text,
	`charge_id` text,
	`note` text,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	`starts_at` integer,
	`ends_at` integer,
	`reminded_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_provider_charge_unique` ON `orders` (`provider`,`charge_id`) WHERE charge_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name_zh` text NOT NULL,
	`name_en` text NOT NULL,
	`days` integer NOT NULL,
	`price_stars` integer NOT NULL,
	`price_usdt` text NOT NULL,
	`slots` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`order_id` integer,
	`entry_username` text,
	`banner` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- Seed products; prices and slots are edited in the admin from here on.
INSERT INTO `products` (`id`, `kind`, `name_zh`, `name_en`, `days`, `price_stars`, `price_usdt`, `slots`, `active`, `sort`) VALUES
	(1, 'pin', '置顶 7 天', 'Pin for 7 days', 7, 500, '10', 10, 1, 10),
	(2, 'pin', '置顶 30 天', 'Pin for 30 days', 30, 1500, '30', 10, 1, 20),
	(3, 'banner', '首页横幅 7 天', 'Home banner for 7 days', 7, 1000, '20', 5, 1, 30),
	(4, 'banner', '首页横幅 30 天', 'Home banner for 30 days', 30, 3000, '60', 5, 1, 40);
