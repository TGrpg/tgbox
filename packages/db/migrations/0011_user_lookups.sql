-- "My submissions" and "my orders" in the Mini App look a user up by their Telegram id, which
-- without these was a full scan of both tables on every app open, by every user. Both tables are
-- low-write (a submission or an order is a deliberate human act, not a refresh), so paying +1 row
-- per insert is cheaper than scanning them for every reader (see .agents/database.md).
-- The id is part of each index so "newest first, limited" is answered from the index alone.
CREATE INDEX `submissions_user` ON `submissions` (`tg_user_id`,`id`);--> statement-breakpoint
CREATE INDEX `orders_user` ON `orders` (`tg_user_id`,`id`);
