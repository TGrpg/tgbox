-- Orders and promotions become AUTOINCREMENT, so a deleted row's id is never handed out again
-- (invoice payloads, USDT quotes, banner images, /r/<id> links and clicks all outlive the row).
-- Ended promotions are kept from now on, with `ended_at` set. No foreign keys point at either
-- table, so the rebuild needs no pragma (D1 doesn't honour `foreign_keys=OFF` anyway).
CREATE TABLE `__new_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
INSERT INTO `__new_orders`("id", "tg_user_id", "product_id", "kind", "days", "target_username", "banner", "status", "provider", "amount", "currency", "invoice_id", "charge_id", "note", "created_at", "paid_at", "starts_at", "ends_at", "reminded_at") SELECT "id", "tg_user_id", "product_id", "kind", "days", "target_username", "banner", "status", "provider", "amount", "currency", "invoice_id", "charge_id", "note", "created_at", "paid_at", "starts_at", "ends_at", "reminded_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_provider_charge_unique` ON `orders` (`provider`,`charge_id`) WHERE charge_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `orders_user` ON `orders` (`tg_user_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_promotions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`order_id` integer,
	`entry_username` text,
	`banner` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_promotions`("id", "kind", "order_id", "entry_username", "banner", "starts_at", "ends_at", "created_at", "ended_at") SELECT "id", "kind", "order_id", "entry_username", "banner", "starts_at", "ends_at", "created_at", NULL FROM `promotions`;--> statement-breakpoint
DROP TABLE `promotions`;--> statement-breakpoint
ALTER TABLE `__new_promotions` RENAME TO `promotions`;--> statement-breakpoint
CREATE INDEX `promotions_order` ON `promotions` (`order_id`) WHERE order_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audit_usdt_unmatched` ON `audit_log` (`target`) WHERE action = 'usdt.unmatched';--> statement-breakpoint
-- An id deleted before this migration may be above every surviving row. Each id ever used is
-- still named somewhere (the audit trail, a USDT quote, a promotion, a click row), so the
-- sequences start above all of them: a placeholder at that id moves the sequence, and is removed.
INSERT INTO `orders` (`id`, `tg_user_id`, `product_id`, `kind`, `days`, `status`, `note`, `created_at`)
SELECT high, 0, 0, 'pin', 0, 'expired', 'id placeholder', 0 FROM (
  SELECT MAX(
    COALESCE((SELECT MAX(`id`) FROM `orders`), 0),
    COALESCE((SELECT MAX(`order_id`) FROM `usdt_payments`), 0),
    COALESCE((SELECT MAX(`order_id`) FROM `promotions`), 0),
    COALESCE((SELECT MAX(CAST(substr(`target`, 7) AS INTEGER)) FROM `audit_log` WHERE `target` LIKE 'order:%'), 0)
  ) AS high
) WHERE high > COALESCE((SELECT MAX(`id`) FROM `orders`), 0);
--> statement-breakpoint
DELETE FROM `orders` WHERE `tg_user_id` = 0 AND `created_at` = 0 AND `note` = 'id placeholder';
--> statement-breakpoint
INSERT INTO `promotions` (`id`, `kind`, `starts_at`, `ends_at`, `created_at`, `ended_at`)
SELECT high, 'pin', 0, 0, 0, 0 FROM (
  SELECT MAX(
    COALESCE((SELECT MAX(`id`) FROM `promotions`), 0),
    COALESCE((SELECT MAX(`promotion_id`) FROM `promotion_clicks`), 0),
    COALESCE((SELECT MAX(CAST(substr(`target`, 11) AS INTEGER)) FROM `audit_log` WHERE `target` LIKE 'promotion:%'), 0)
  ) AS high
) WHERE high > COALESCE((SELECT MAX(`id`) FROM `promotions`), 0);
--> statement-breakpoint
DELETE FROM `promotions` WHERE `created_at` = 0 AND `starts_at` = 0 AND `ends_at` = 0;
