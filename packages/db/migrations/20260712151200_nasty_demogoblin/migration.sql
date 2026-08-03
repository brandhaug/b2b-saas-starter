ALTER TABLE `appointments` ADD `booking_party_id` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `booking_request_id` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_appointments` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`booking_session_id` text,
	`booking_party_id` text,
	`booking_request_id` text UNIQUE,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`snapshot` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_appointments_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_appointments_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "appointments_valid_status" CHECK("status" in ('scheduled', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "appointments_valid_interval" CHECK("starts_at" < "ends_at")
);
--> statement-breakpoint
INSERT INTO `__new_appointments`(`id`, `merchant_id`, `provider_id`, `booking_session_id`, `status`, `starts_at`, `ends_at`, `snapshot`, `created_at`, `updated_at`) SELECT `id`, `merchant_id`, `provider_id`, `booking_session_id`, `status`, `starts_at`, `ends_at`, `snapshot`, `created_at`, COALESCE(`updated_at`, `created_at`) FROM `appointments`;--> statement-breakpoint
DROP TABLE `appointments`;--> statement-breakpoint
ALTER TABLE `__new_appointments` RENAME TO `appointments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `appointments_merchant_id_idx` ON `appointments` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `appointments_booking_session_id_idx` ON `appointments` (`booking_session_id`);--> statement-breakpoint
CREATE INDEX `appointments_booking_party_id_idx` ON `appointments` (`booking_party_id`);--> statement-breakpoint
CREATE INDEX `appointments_provider_interval_idx` ON `appointments` (`provider_id`,`starts_at`,`ends_at`);
