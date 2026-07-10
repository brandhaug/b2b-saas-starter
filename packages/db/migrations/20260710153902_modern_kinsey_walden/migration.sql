CREATE TABLE `booking_sessions` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`capability_hash` text NOT NULL UNIQUE,
	`checkout_path` text DEFAULT 'pay_in_person' NOT NULL,
	`lifecycle` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`idle_expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL,
	CONSTRAINT `fk_booking_sessions_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT "booking_sessions_pay_in_person_only" CHECK("checkout_path" = 'pay_in_person'),
	CONSTRAINT "booking_sessions_valid_lifecycle" CHECK("lifecycle" in ('active', 'consumed'))
);
--> statement-breakpoint
CREATE INDEX `booking_sessions_merchant_id_idx` ON `booking_sessions` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `booking_sessions_expiry_idx` ON `booking_sessions` (`lifecycle`,`idle_expires_at`,`absolute_expires_at`);