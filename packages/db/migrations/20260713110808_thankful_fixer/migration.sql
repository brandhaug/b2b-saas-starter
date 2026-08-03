CREATE TABLE `appointment_cancellations` (
	`id` text PRIMARY KEY,
	`appointment_id` text NOT NULL UNIQUE,
	`command_id` text NOT NULL,
	`reason_code` text NOT NULL,
	`cancellation_policy_id` text NOT NULL,
	`cancellation_policy_version` integer NOT NULL,
	`refund_policy_id` text NOT NULL,
	`refund_policy_version` integer NOT NULL,
	`cancelled_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_appointment_cancellations_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_appointment_cancellations_command_id_cancellation_commands_id_fk` FOREIGN KEY (`command_id`) REFERENCES `cancellation_commands`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `cancellation_commands` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`scope` text NOT NULL,
	`target_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`result_json` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_cancellation_commands_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `refund_obligation_allocations` (
	`refund_obligation_id` text NOT NULL,
	`position` integer NOT NULL,
	`tender` text NOT NULL,
	`reference_id` text,
	`amount_minor` integer NOT NULL,
	CONSTRAINT `refund_obligation_allocations_pk` PRIMARY KEY(`refund_obligation_id`, `position`),
	CONSTRAINT `fk_refund_obligation_allocations_refund_obligation_id_refund_obligations_id_fk` FOREIGN KEY (`refund_obligation_id`) REFERENCES `refund_obligations`(`id`) ON DELETE CASCADE,
	CONSTRAINT "refund_obligation_allocations_positive_amount" CHECK("amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE `refund_obligations` (
	`id` text PRIMARY KEY,
	`appointment_id` text NOT NULL UNIQUE,
	`booking_party_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`idempotency_key` text NOT NULL UNIQUE,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`failure_code` text,
	`provider_event_id` text UNIQUE,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_refund_obligations_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_refund_obligations_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "refund_obligations_positive_amount" CHECK("amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `appointment_cancellations_command_idx` ON `appointment_cancellations` (`command_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cancellation_commands_idempotency_unique` ON `cancellation_commands` (`merchant_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `cancellation_commands_target_unique` ON `cancellation_commands` (`merchant_id`,`scope`,`target_id`);--> statement-breakpoint
CREATE INDEX `cancellation_commands_merchant_idx` ON `cancellation_commands` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `refund_obligations_status_idx` ON `refund_obligations` (`status`,`updated_at`);
