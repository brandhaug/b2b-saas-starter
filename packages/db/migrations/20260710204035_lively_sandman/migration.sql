PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_booking_sessions` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`capability_hash` text NOT NULL UNIQUE,
	`checkout_path` text DEFAULT 'pay_in_person',
	`lifecycle` text DEFAULT 'active' NOT NULL,
	`provider_preference` text,
	`provider_id` text,
	`primary_service_id` text,
	`customer_name` text,
	`customer_email` text,
	`customer_phone` text,
	`confirmed_appointment_id` text,
	`confirmed_at` text,
	`replay_expires_at` text,
	`created_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`idle_expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL,
	CONSTRAINT `fk_booking_sessions_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_booking_sessions_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_booking_sessions_primary_service_id_services_id_fk` FOREIGN KEY (`primary_service_id`) REFERENCES `services`(`id`) ON DELETE SET NULL,
	CONSTRAINT "booking_sessions_pay_in_person_only" CHECK("checkout_path" = 'pay_in_person'),
	CONSTRAINT "booking_sessions_valid_lifecycle" CHECK("lifecycle" in ('active', 'consumed'))
);
--> statement-breakpoint
INSERT INTO `__new_booking_sessions`(`id`, `merchant_id`, `capability_hash`, `checkout_path`, `lifecycle`, `provider_preference`, `provider_id`, `primary_service_id`, `customer_name`, `customer_email`, `customer_phone`, `confirmed_appointment_id`, `confirmed_at`, `replay_expires_at`, `created_at`, `last_activity_at`, `idle_expires_at`, `absolute_expires_at`) SELECT `id`, `merchant_id`, `capability_hash`, `checkout_path`, `lifecycle`, `provider_preference`, `provider_id`, `primary_service_id`, `customer_name`, `customer_email`, `customer_phone`, `confirmed_appointment_id`, `confirmed_at`, `replay_expires_at`, `created_at`, `last_activity_at`, `idle_expires_at`, `absolute_expires_at` FROM `booking_sessions`;--> statement-breakpoint
DROP TABLE `booking_sessions`;--> statement-breakpoint
ALTER TABLE `__new_booking_sessions` RENAME TO `booking_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `booking_sessions_merchant_id_idx` ON `booking_sessions` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `booking_sessions_expiry_idx` ON `booking_sessions` (`lifecycle`,`idle_expires_at`,`absolute_expires_at`);