CREATE TABLE `operations_notification_intents` (
	`id` text PRIMARY KEY,
	`impersonation_id` text NOT NULL,
	`event_type` text NOT NULL,
	`recipient_email` text NOT NULL,
	`merchant_id` text NOT NULL,
	`merchant_name` text NOT NULL,
	`occurred_at` text NOT NULL,
	`support_reference` text,
	`security_contact` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`available_at` text NOT NULL,
	`claimed_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`failure_code` text,
	`delivered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_notification_intents_lifecycle_unique` ON `operations_notification_intents` (`impersonation_id`,`event_type`);
--> statement-breakpoint
CREATE INDEX `operations_notification_intents_status_available_idx` ON `operations_notification_intents` (`status`,`available_at`);
