DROP INDEX IF EXISTS `customer_contacts_active_value_unique`;--> statement-breakpoint

CREATE INDEX `customer_contacts_active_value_lookup`
ON `customer_contacts` (`merchant_id`,`kind`,`normalized_value`)
WHERE `status` = 'active';--> statement-breakpoint

CREATE TABLE `customer_observations` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `customer_record_id` text NOT NULL REFERENCES `customer_records`(`id`) ON DELETE CASCADE,
  `appointment_id` text NOT NULL REFERENCES `appointments`(`id`) ON DELETE RESTRICT,
  `name` text NOT NULL,
  `normalized_email` text,
  `normalized_phone` text,
  `source` text NOT NULL CHECK (`source` IN ('public_booking','merchant_created','record_completed')),
  `observed_at` text NOT NULL,
  UNIQUE (`appointment_id`)
);--> statement-breakpoint
CREATE INDEX `customer_observations_record_time_idx`
ON `customer_observations` (`customer_record_id`,`observed_at`);--> statement-breakpoint

CREATE TABLE `customer_duplicate_suggestions` (
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `customer_record_id` text NOT NULL REFERENCES `customer_records`(`id`) ON DELETE CASCADE,
  `possible_duplicate_id` text NOT NULL REFERENCES `customer_records`(`id`) ON DELETE CASCADE,
  `created_at` text NOT NULL,
  PRIMARY KEY (`customer_record_id`,`possible_duplicate_id`),
  CHECK (`customer_record_id` <> `possible_duplicate_id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bans` (
  `customer_record_id` text PRIMARY KEY NOT NULL REFERENCES `customer_records`(`id`) ON DELETE CASCADE,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `reason` text NOT NULL,
  `actor_id` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text
);
--> statement-breakpoint
CREATE INDEX `customer_bans_merchant_expiry_idx`
ON `customer_bans` (`merchant_id`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `customer_directory_history` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `customer_record_id` text NOT NULL REFERENCES `customer_records`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL,
  `actor_id` text NOT NULL,
  `reason` text,
  `revision` integer NOT NULL CHECK (`revision` > 0),
  `occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_directory_history_record_revision_idx`
ON `customer_directory_history` (`customer_record_id`,`revision`);
