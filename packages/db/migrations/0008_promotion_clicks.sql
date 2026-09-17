-- WITHOUT ROWID: the composite primary key is the table itself, so a click costs one row written
-- instead of two (a rowid table would also write the implicit unique index row). Clicks are the
-- highest-volume write in the system, and the free plan allows 100k rows/day.
CREATE TABLE `promotion_clicks` (
	`promotion_id` integer NOT NULL,
	`day` text NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`promotion_id`, `day`)
) WITHOUT ROWID;
