CREATE TABLE `appointments` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_appointments_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_appointments_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "appointments_valid_status" CHECK("status" in ('scheduled', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "appointments_valid_interval" CHECK("starts_at" < "ends_at")
);
--> statement-breakpoint
CREATE TABLE `time_slot_holds` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`booking_session_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`quote` text NOT NULL,
	CONSTRAINT `fk_time_slot_holds_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_time_slot_holds_booking_session_id_booking_sessions_id_fk` FOREIGN KEY (`booking_session_id`) REFERENCES `booking_sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_time_slot_holds_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "time_slot_holds_valid_interval" CHECK("starts_at" < "ends_at"),
	CONSTRAINT "time_slot_holds_valid_expiry" CHECK("created_at" < "expires_at")
);
--> statement-breakpoint
CREATE INDEX `appointments_merchant_id_idx` ON `appointments` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `appointments_provider_interval_idx` ON `appointments` (`provider_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `time_slot_holds_merchant_id_idx` ON `time_slot_holds` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `time_slot_holds_session_expiry_idx` ON `time_slot_holds` (`booking_session_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `time_slot_holds_provider_interval_idx` ON `time_slot_holds` (`provider_id`,`starts_at`,`ends_at`,`expires_at`);