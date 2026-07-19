ALTER TABLE `session` ADD `operatorTotpVerifiedAt` integer;
--> statement-breakpoint
CREATE TABLE `impersonation_records` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`operator_session_id` text NOT NULL,
	`target_member_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`lifecycle` text NOT NULL,
	`reason` text NOT NULL,
	`support_reference` text,
	`ticket_hash` text NOT NULL,
	`handoff_expires_at` integer NOT NULL,
	`merchant_session_id` text,
	`active_expires_at` integer,
	`terminal_at` integer,
	`termination_cause` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `impersonation_records_ticket_hash_unique` ON `impersonation_records` (`ticket_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `impersonation_records_operator_open_unique` ON `impersonation_records` (`operator_id`) WHERE `lifecycle` IN ('pending-handoff', 'active');
--> statement-breakpoint
CREATE UNIQUE INDEX `impersonation_records_target_open_unique` ON `impersonation_records` (`target_member_id`) WHERE `lifecycle` IN ('pending-handoff', 'active');
--> statement-breakpoint
CREATE INDEX `impersonation_records_handoff_expiry_idx` ON `impersonation_records` (`lifecycle`,`handoff_expires_at`);
--> statement-breakpoint
CREATE INDEX `impersonation_records_operator_session_idx` ON `impersonation_records` (`operator_session_id`);
