-- Promotion tiers: highlight and category pin below the site-wide pin, and a sponsored
-- announcement bar beside the home banner. Default prices at the existing 80 Stars per USDT; the
-- operator edits them in the admin. Product `slots` for category_pin is per category.
INSERT INTO `products` (`kind`, `name_zh`, `name_en`, `days`, `price_stars`, `price_usdt`, `slots`, `active`, `sort`) VALUES
	('highlight', '高亮 7 天', 'Highlight for 7 days', 7, 240, '3', 30, 1, 2),
	('highlight', '高亮 30 天', 'Highlight for 30 days', 30, 720, '9', 30, 1, 4),
	('category_pin', '分类置顶 7 天', 'Category pin for 7 days', 7, 400, '5', 3, 1, 6),
	('category_pin', '分类置顶 30 天', 'Category pin for 30 days', 30, 1200, '15', 3, 1, 8),
	('announcement', '顶部公告条 7 天', 'Top announcement bar for 7 days', 7, 2400, '30', 1, 1, 50),
	('announcement', '顶部公告条 30 天', 'Top announcement bar for 30 days', 30, 7200, '90', 1, 1, 60);
--> statement-breakpoint
-- The old pin is the site-wide one now; rename it only where the admin kept the seeded name.
UPDATE `products` SET `name_zh` = '全站' || `name_zh` WHERE `kind` = 'pin' AND `name_zh` LIKE '置顶 %';
--> statement-breakpoint
UPDATE `products` SET `name_en` = 'Site-wide pin' || substr(`name_en`, 4) WHERE `kind` = 'pin' AND `name_en` LIKE 'Pin %';
