ALTER TABLE `bot_users` ADD `avatar_key` text;--> statement-breakpoint
ALTER TABLE `bot_users` ADD `avatar_checked_at` integer;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `format` text DEFAULT 'plain' NOT NULL;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `media` text;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `buttons` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `buttons_per_row` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `silent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `protect` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `no_preview` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- The single URL button becomes the first of a button list; the old columns go in the next migration.
UPDATE `broadcasts` SET `buttons` = json_array(json_object('text', `button_text`, 'url', `button_url`)) WHERE `button_text` IS NOT NULL AND `button_url` IS NOT NULL;
