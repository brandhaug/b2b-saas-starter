CREATE TABLE `appointment_email_intents` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE CASCADE,
  `shop_id` text NOT NULL REFERENCES `shops`(`id`) ON DELETE CASCADE,
  `source_type` text NOT NULL CHECK (`source_type` IN ('appointment','appointment_series','booking_party')),
  `source_id` text NOT NULL,
  `source_revision` integer NOT NULL CHECK (`source_revision` > 0),
  `appointment_ids_json` text NOT NULL,
  `purpose` text NOT NULL CHECK (`purpose` IN ('appointment_confirmation','appointment_reschedule','appointment_cancellation','appointment_reminder')),
  `semantic_key` text NOT NULL UNIQUE,
  `locale` text NOT NULL CHECK (`locale` IN ('ro','en')),
  `template_key` text NOT NULL,
  `template_version` integer NOT NULL,
  `destination_ciphertext` text,
  `destination_key_version` integer NOT NULL,
  `destination_fingerprint` text,
  `masked_destination` text,
  `facts_json` text NOT NULL,
  `facts_fingerprint` text NOT NULL,
  `available_at` text NOT NULL,
  `useful_until` text,
  `status` text NOT NULL CHECK (`status` IN ('pending','claimed','captured','accepted','delivered','failed','suppressed','unavailable','submission_unknown','superseded','superseded_after_submission')),
  `status_reason` text,
  `attempt_count` integer DEFAULT 0 NOT NULL CHECK (`attempt_count` >= 0),
  `next_attempt_at` text,
  `claimed_at` text,
  `claim_token` text,
  `provider_reference_fingerprint` text UNIQUE,
  `accepted_at` text,
  `delivered_at` text,
  `latest_provider_occurred_at` text,
  `terminal_at` text,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
CREATE INDEX `appointment_email_intents_due_idx` ON `appointment_email_intents` (`status`,`next_attempt_at`,`available_at`);
CREATE INDEX `appointment_email_intents_source_idx` ON `appointment_email_intents` (`source_type`,`source_id`,`source_revision`);
CREATE INDEX `appointment_email_intents_appointment_idx` ON `appointment_email_intents` (`shop_id`,`created_at`);

CREATE TABLE `appointment_email_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `intent_id` text NOT NULL REFERENCES `appointment_email_intents`(`id`) ON DELETE CASCADE,
  `ordinal` integer NOT NULL CHECK (`ordinal` > 0),
  `idempotency_key` text NOT NULL UNIQUE,
  `state` text NOT NULL CHECK (`state` IN ('prepared','submitting','captured','accepted','failed_retryable','failed_terminal','submission_unknown')),
  `failure_code` text,
  `started_at` text NOT NULL,
  `completed_at` text,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  UNIQUE (`intent_id`,`ordinal`)
);
CREATE INDEX `appointment_email_attempts_intent_idx` ON `appointment_email_attempts` (`intent_id`,`started_at`);

CREATE TABLE `appointment_email_callback_receipts` (
  `event_fingerprint` text PRIMARY KEY NOT NULL,
  `intent_id` text REFERENCES `appointment_email_intents`(`id`) ON DELETE SET NULL,
  `provider_reference_fingerprint` text NOT NULL,
  `provider_status` text NOT NULL CHECK (`provider_status` IN ('delivered','failed')),
  `provider_occurred_at` text NOT NULL,
  `normalized_code` text,
  `outcome` text NOT NULL CHECK (`outcome` IN ('pending','applied','out_of_order')),
  `received_at` text NOT NULL
);
CREATE INDEX `appointment_email_callbacks_provider_idx` ON `appointment_email_callback_receipts` (`provider_reference_fingerprint`,`provider_occurred_at`);

CREATE TABLE `appointment_email_dead_letters` (
  `id` text PRIMARY KEY NOT NULL,
  `intent_id` text NOT NULL UNIQUE REFERENCES `appointment_email_intents`(`id`) ON DELETE CASCADE,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE CASCADE,
  `safe_reason` text NOT NULL,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
CREATE INDEX `appointment_email_dead_letters_merchant_idx` ON `appointment_email_dead_letters` (`merchant_id`);

CREATE TABLE `appointment_email_attention` (
  `id` text PRIMARY KEY NOT NULL,
  `intent_id` text NOT NULL UNIQUE REFERENCES `appointment_email_intents`(`id`) ON DELETE CASCADE,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL CHECK (`kind` IN ('complaint','hard_bounce','submission_unknown','delivery_failed')),
  `status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open','resolved')),
  `safe_summary` text NOT NULL,
  `opened_at` text NOT NULL,
  `resolved_at` text
);
CREATE INDEX `appointment_email_attention_status_idx` ON `appointment_email_attention` (`status`,`opened_at`);
