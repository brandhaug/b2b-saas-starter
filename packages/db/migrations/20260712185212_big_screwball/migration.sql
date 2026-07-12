CREATE TABLE `customer_account_sessions` (
	`id` text PRIMARY KEY,
	`customer_account_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_customer_account_sessions_customer_account_id_customer_identities_id_fk` FOREIGN KEY (`customer_account_id`) REFERENCES `customer_identities`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `customer_booking_associations` (
	`booking_party_id` text PRIMARY KEY,
	`customer_account_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`confirmation_route_id` text NOT NULL,
	`customer_details_json` text NOT NULL,
	`associated_at` text NOT NULL,
	CONSTRAINT `fk_customer_booking_associations_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_customer_booking_associations_customer_account_id_customer_identities_id_fk` FOREIGN KEY (`customer_account_id`) REFERENCES `customer_identities`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_customer_booking_associations_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `customer_identities` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`verified_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_access_proofs` (
	`id` text PRIMARY KEY,
	`booking_session_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`proof_hash` text NOT NULL UNIQUE,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_provider_access_proofs_booking_session_id_booking_sessions_id_fk` FOREIGN KEY (`booking_session_id`) REFERENCES `booking_sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_provider_access_proofs_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `providers` ADD `booking_access_verifier_hash` text;--> statement-breakpoint
CREATE INDEX `customer_account_sessions_account_idx` ON `customer_account_sessions` (`customer_account_id`);--> statement-breakpoint
CREATE INDEX `customer_booking_associations_owner_idx` ON `customer_booking_associations` (`customer_account_id`,`merchant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_identities_provider_subject_unique` ON `customer_identities` (`provider`,`provider_subject`);--> statement-breakpoint
CREATE INDEX `provider_access_proofs_scope_idx` ON `provider_access_proofs` (`booking_session_id`,`provider_id`,`expires_at`);
