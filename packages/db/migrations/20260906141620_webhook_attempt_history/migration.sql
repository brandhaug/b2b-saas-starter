CREATE TABLE `webhook_delivery_attempts` (
	`id` text PRIMARY KEY,
	`delivery_id` text NOT NULL,
	`attempts` integer NOT NULL,
	`phase` text NOT NULL,
	`status` text NOT NULL,
	`attempted_at` text NOT NULL,
	`duration_ms` integer,
	`failure_reason` text,
	`response_status` integer,
	`request_headers` text,
	`response_body` text,
	CONSTRAINT `fk_webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk` FOREIGN KEY (`delivery_id`) REFERENCES `webhook_deliveries`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD `last_attempt_token` text;--> statement-breakpoint
CREATE INDEX `webhook_deliveries_retention_idx` ON `webhook_deliveries` (`last_attempt_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_attempt_identity_idx` ON `webhook_delivery_attempts` (`delivery_id`,`attempts`,`phase`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_terminal_identity_idx` ON `webhook_delivery_attempts` (`delivery_id`) WHERE "webhook_delivery_attempts"."phase" = 'terminal';