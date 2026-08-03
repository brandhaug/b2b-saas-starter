CREATE INDEX `customer_contacts_active_value_lookup`
ON `customer_contacts` (`merchant_id`,`kind`,`normalized_value`)
WHERE `status` = 'active';--> statement-breakpoint

ALTER TABLE `customer_records` ADD `merged_into` text;
--> statement-breakpoint
CREATE TRIGGER `customer_directory_states_revision_guard`
BEFORE UPDATE ON `customer_directory_states`
WHEN NEW.`revision` <> OLD.`revision` + 1
BEGIN
  SELECT RAISE(ABORT, 'customer_directory_stale_revision');
END;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER `customer_contacts_merchant_guard`
BEFORE INSERT ON `customer_contacts`
WHEN NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`customer_record_id` AND `merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'customer_contact_merchant_mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `customer_observations_merchant_guard`
BEFORE INSERT ON `customer_observations`
WHEN NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`customer_record_id` AND `merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'customer_observation_merchant_mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `customer_bans_merchant_guard`
BEFORE INSERT ON `customer_bans`
WHEN NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`customer_record_id` AND `merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'customer_ban_merchant_mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `customer_history_merchant_guard`
BEFORE INSERT ON `customer_directory_history`
WHEN NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`customer_record_id` AND `merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'customer_history_merchant_mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `customer_duplicates_merchant_guard`
BEFORE INSERT ON `customer_duplicate_suggestions`
WHEN NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`customer_record_id` AND `merchant_id` = NEW.`merchant_id`
) OR NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`possible_duplicate_id` AND `merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'customer_duplicate_merchant_mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_foundations_customer_merchant_guard`
BEFORE INSERT ON `appointment_foundations`
WHEN NEW.`customer_record_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`customer_record_id` AND `merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'appointment_customer_merchant_mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `customer_contacts_merchant_update_guard`
BEFORE UPDATE OF `customer_record_id`, `merchant_id` ON `customer_contacts`
WHEN NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`customer_record_id` AND `merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'customer_contact_merchant_mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `customer_observations_merchant_update_guard`
BEFORE UPDATE OF `customer_record_id`, `merchant_id` ON `customer_observations`
WHEN NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`customer_record_id` AND `merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'customer_observation_merchant_mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_foundations_customer_merchant_update_guard`
BEFORE UPDATE OF `customer_record_id`, `merchant_id` ON `appointment_foundations`
WHEN NEW.`customer_record_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `customer_records`
  WHERE `id` = NEW.`customer_record_id` AND `merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'appointment_customer_merchant_mismatch'); END;
