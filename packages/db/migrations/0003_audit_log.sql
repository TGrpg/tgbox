CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`payload` text,
	`created_at` integer NOT NULL
);
