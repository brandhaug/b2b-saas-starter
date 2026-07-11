CREATE TABLE `platform_webhook_events` (
	`id` text PRIMARY KEY,
	`outbox_id` text NOT NULL UNIQUE,
	`merchant_id` text NOT NULL,
	`event_type` text NOT NULL,
	`raw_body` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_platform_webhook_events_outbox_id_booking_outbox_id_fk` FOREIGN KEY (`outbox_id`) REFERENCES `booking_outbox`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_platform_webhook_events_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `booking_outbox` ADD `claimed_at` text;--> statement-breakpoint
ALTER TABLE `booking_outbox` ADD `email_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_outbox` ADD `email_failure_code` text;--> statement-breakpoint
ALTER TABLE `booking_outbox` ADD `webhook_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
CREATE INDEX `platform_webhook_events_merchant_created_idx` ON `platform_webhook_events` (`merchant_id`,`created_at`);