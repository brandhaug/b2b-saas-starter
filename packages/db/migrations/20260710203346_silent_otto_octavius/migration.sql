ALTER TABLE `appointments` ADD `booking_session_id` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `snapshot` text;--> statement-breakpoint
ALTER TABLE `booking_sessions` ADD `confirmed_appointment_id` text;--> statement-breakpoint
ALTER TABLE `booking_sessions` ADD `confirmed_at` text;--> statement-breakpoint
ALTER TABLE `booking_sessions` ADD `replay_expires_at` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_appointments` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`booking_session_id` text UNIQUE,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`snapshot` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_appointments_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_appointments_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "appointments_valid_status" CHECK("status" in ('scheduled', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "appointments_valid_interval" CHECK("starts_at" < "ends_at")
);
--> statement-breakpoint
INSERT INTO `__new_appointments`(`id`, `merchant_id`, `provider_id`, `status`, `starts_at`, `ends_at`, `created_at`) SELECT `id`, `merchant_id`, `provider_id`, `status`, `starts_at`, `ends_at`, `created_at` FROM `appointments`;--> statement-breakpoint
DROP TABLE `appointments`;--> statement-breakpoint
ALTER TABLE `__new_appointments` RENAME TO `appointments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `appointments_merchant_id_idx` ON `appointments` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `appointments_provider_interval_idx` ON `appointments` (`provider_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `booking_outbox` (
	`id` text PRIMARY KEY,
	`appointment_id` text NOT NULL UNIQUE,
	`kind` text NOT NULL,
	`trace_id` text NOT NULL,
	`created_at` text NOT NULL,
	`processed_at` text,
	CONSTRAINT `fk_booking_outbox_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE TABLE `confirmation_access` (
	`route_id` text PRIMARY KEY,
	`appointment_id` text NOT NULL UNIQUE,
	`token_version` integer DEFAULT 1 NOT NULL,
	`signing_key_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_confirmation_access_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX `booking_outbox_pending_idx` ON `booking_outbox` (`processed_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `confirmation_access_expiry_idx` ON `confirmation_access` (`expires_at`);
