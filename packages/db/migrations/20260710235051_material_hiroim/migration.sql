CREATE TABLE `platform_webhook_deliveries` (
	`id` text PRIMARY KEY,
	`endpoint_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`attempt_number` integer NOT NULL,
	`response_status` integer,
	`duration_ms` integer NOT NULL,
	`attempted_at` text NOT NULL,
	`next_attempt_at` text,
	CONSTRAINT `fk_platform_webhook_deliveries_endpoint_id_platform_webhook_endpoints_id_fk` FOREIGN KEY (`endpoint_id`) REFERENCES `platform_webhook_endpoints`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `platform_webhook_endpoints` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`signing_secret` text NOT NULL,
	`status` text NOT NULL,
	`events` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`disabled_at` text,
	CONSTRAINT `fk_platform_webhook_endpoints_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `platform_webhook_deliveries_endpoint_attempted_idx` ON `platform_webhook_deliveries` (`endpoint_id`,`attempted_at`,`id`);--> statement-breakpoint
CREATE INDEX `platform_webhook_endpoints_merchant_updated_idx` ON `platform_webhook_endpoints` (`merchant_id`,`updated_at`,`id`);