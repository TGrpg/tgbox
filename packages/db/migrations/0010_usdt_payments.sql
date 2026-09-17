-- One row per order awaiting an on-chain USDT transfer. The order id is the primary key, so a
-- retried callback can never create a second payment record for the same order.
CREATE TABLE `usdt_payments` (
	`order_id` integer PRIMARY KEY NOT NULL,
	`chain` text DEFAULT 'trc20' NOT NULL,
	`amount_micro` integer NOT NULL,
	`address` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`tx_hash` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`paid_at` integer
);
--> statement-breakpoint
-- The watcher looks up an incoming transfer by its exact amount, and only unpaid orders can be
-- matched. Partial, so a row stops paying for the index the moment it is paid or expires: the
-- index costs +1 row written only while an order is actually waiting (see .agents/database.md).
CREATE INDEX `usdt_pending_amount` ON `usdt_payments` (`amount_micro`) WHERE `status` = 'pending';
