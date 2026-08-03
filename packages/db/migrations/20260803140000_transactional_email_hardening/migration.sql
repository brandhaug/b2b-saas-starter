ALTER TABLE `transactional_email_evidence`
  ADD COLUMN `latest_provider_occurred_at` text;--> statement-breakpoint
ALTER TABLE `transactional_email_evidence`
  ADD COLUMN `destination_fingerprint` text;--> statement-breakpoint
CREATE TABLE `transactional_email_callback_receipts_hardened` (
  `event_id` text PRIMARY KEY NOT NULL,
  `evidence_id` text REFERENCES `transactional_email_evidence`(`id`) ON DELETE SET NULL,
  `outcome` text NOT NULL CHECK (`outcome` IN ('pending','applied','out_of_order','ignored_unknown_submission')),
  `provider_reference_fingerprint` text,
  `provider_status` text CHECK (`provider_status` IN ('delivered','failed')),
  `provider_occurred_at` text,
  `normalized_code` text,
  `received_at` text NOT NULL
);--> statement-breakpoint
-- Legacy receipts used raw provider event IDs. Do not carry those provider-controlled
-- identifiers across the redaction boundary; terminal evidence remains monotonic.
DROP TABLE `transactional_email_callback_receipts`;--> statement-breakpoint
ALTER TABLE `transactional_email_callback_receipts_hardened`
  RENAME TO `transactional_email_callback_receipts`;--> statement-breakpoint
CREATE INDEX `transactional_email_callback_pending_idx`
  ON `transactional_email_callback_receipts`
  (`provider_reference_fingerprint`, `outcome`, `provider_occurred_at`);
