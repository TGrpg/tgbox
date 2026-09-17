ALTER TABLE `categories` ADD `icon` text;--> statement-breakpoint
-- Seed icons from the web's former slug → icon map; the admin edits them from here on.
UPDATE `categories` SET `icon` = 'news' WHERE `slug` = 'news' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'movie' WHERE `slug` = 'video' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'apps' WHERE `slug` = 'software' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'share' WHERE `slug` = 'resources' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'school' WHERE `slug` = 'learning' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'mood-happy' WHERE `slug` = 'fun' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'book' WHERE `slug` = 'books' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'article' WHERE `slug` = 'blog' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'photo' WHERE `slug` = 'wallpaper' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'code' WHERE `slug` = 'tech' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'sparkles' WHERE `slug` = 'ai' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'discount' WHERE `slug` = 'deals' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'device-gamepad-2' WHERE `slug` = 'games' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'sticker' WHERE `slug` = 'stickers' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'compass' WHERE `slug` = 'nav' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'message-circle' WHERE `slug` = 'chat' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'heart' WHERE `slug` = 'interest' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'server' WHERE `slug` = 'vps' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'brand-apple' WHERE `slug` = 'ios' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'dots' WHERE `slug` = 'other' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'tool' WHERE `slug` = 'tools' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'send' WHERE `slug` = 'messaging' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'shield' WHERE `slug` = 'group-admin' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'search' WHERE `slug` = 'search' AND `icon` IS NULL;
UPDATE `categories` SET `icon` = 'download' WHERE `slug` = 'media' AND `icon` IS NULL;
