CREATE TABLE `appointment_operation_commands` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `idempotency_key` text NOT NULL,
  `payload_fingerprint` text NOT NULL,
  `operation_id` text NOT NULL,
  `result_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_operation_commands_merchant_key_unique`
  ON `appointment_operation_commands` (`merchant_id`, `idempotency_key`);
--> statement-breakpoint
CREATE TABLE `appointment_operation_history` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `appointment_id` text NOT NULL REFERENCES `appointments`(`id`) ON DELETE RESTRICT,
  `operation_id` text NOT NULL,
  `command` text NOT NULL,
  `actor_id` text NOT NULL,
  `impersonated_by` text,
  `prior_revision` integer NOT NULL,
  `resulting_revision` integer NOT NULL,
  `facts_json` text NOT NULL,
  `reason` text,
  `notification_choice_json` text,
  `occurred_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `appointment_operation_history_appointment_merchant_fk`
    FOREIGN KEY (`appointment_id`, `merchant_id`)
    REFERENCES `appointments` (`id`, `merchant_id`) ON DELETE RESTRICT,
  CONSTRAINT `appointment_operation_history_revision_step`
    CHECK (`resulting_revision` = `prior_revision` + 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_operation_history_operation_appointment_unique`
  ON `appointment_operation_history` (`operation_id`, `appointment_id`);
--> statement-breakpoint
CREATE INDEX `appointment_operation_history_appointment_revision_idx`
  ON `appointment_operation_history` (`appointment_id`, `resulting_revision`);
--> statement-breakpoint
DROP TRIGGER `appointment_foundations_series_immutable_guard`;
--> statement-breakpoint
CREATE TRIGGER `appointment_foundations_series_immutable_guard`
BEFORE UPDATE OF `series_id`,`series_position` ON `appointment_foundations`
WHEN NOT (
  OLD.`series_id` IS NULL
  AND NEW.`series_id` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `capability_transaction_guards` g
    WHERE g.`id` = 'appointment-series-membership:' || NEW.`series_id`
      AND g.`accepted` = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'Appointment Series membership is immutable'); END;
