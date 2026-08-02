CREATE TABLE `transactional_email_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE CASCADE,
  `owner_user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE RESTRICT,
  `idempotency_key` text NOT NULL UNIQUE,
  `purpose` text NOT NULL CHECK (`purpose` = 'owner_activation_test'),
  `locale` text NOT NULL CHECK (`locale` IN ('ro','en')),
  `template_key` text NOT NULL,
  `masked_destination` text NOT NULL,
  `sender_identity` text NOT NULL,
  `provider_reference_fingerprint` text UNIQUE,
  `status` text NOT NULL CHECK (`status` IN ('submitting','captured','accepted','delivered','failed','submission_unknown')),
  `failure_code` text,
  `attempted_at` text NOT NULL,
  `attempt_count` integer DEFAULT 1 NOT NULL CHECK (`attempt_count` > 0),
  `retryable` integer DEFAULT 0 NOT NULL CHECK (`retryable` IN (0,1)),
  `accepted_at` text,
  `delivered_at` text,
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `transactional_email_evidence_readiness_idx`
  ON `transactional_email_evidence` (`merchant_id`,`purpose`,`status`);--> statement-breakpoint
CREATE TABLE `transactional_email_callback_receipts` (
  `event_id` text PRIMARY KEY NOT NULL,
  `evidence_id` text REFERENCES `transactional_email_evidence`(`id`) ON DELETE SET NULL,
  `outcome` text NOT NULL CHECK (`outcome` IN ('pending','applied','ignored_unknown_submission')),
  `received_at` text NOT NULL
);
