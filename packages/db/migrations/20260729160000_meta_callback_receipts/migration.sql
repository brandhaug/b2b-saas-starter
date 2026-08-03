ALTER TABLE `provider_evidence` ADD `classification_policy_version` text;
--> statement-breakpoint
ALTER TABLE `provider_evidence` ADD `provider_code` integer;
--> statement-breakpoint
ALTER TABLE `provider_evidence` ADD `pricing_policy_version` text;
--> statement-breakpoint
ALTER TABLE `provider_evidence` ADD `provider_billable` integer;
--> statement-breakpoint
ALTER TABLE `provider_evidence` ADD `provider_pricing_category` text;
--> statement-breakpoint
ALTER TABLE `provider_evidence` ADD `provider_pricing_model` text;
--> statement-breakpoint
DROP INDEX `provider_evidence_message_status_unique`;
--> statement-breakpoint
CREATE TABLE `provider_callback_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `environment` text NOT NULL,
  `provider` text NOT NULL,
  `provider_account_key` text NOT NULL,
  `raw_body_digest` text NOT NULL,
  `byte_length` integer NOT NULL,
  `event_count` integer NOT NULL,
  `received_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `provider_callback_receipts_identity_unique`
    UNIQUE (`environment`, `provider`, `provider_account_key`, `raw_body_digest`),
  CONSTRAINT `provider_callback_receipts_provider_check`
    CHECK (`provider` IN ('meta', 'smso')),
  CONSTRAINT `provider_callback_receipts_size_check`
    CHECK (`byte_length` >= 0 AND `event_count` >= 0)
);
--> statement-breakpoint
CREATE INDEX `provider_callback_receipts_received_idx`
  ON `provider_callback_receipts` (`provider`, `received_at`);
--> statement-breakpoint
CREATE TRIGGER `provider_callback_receipts_no_update`
  BEFORE UPDATE ON `provider_callback_receipts`
  BEGIN SELECT RAISE(ABORT, 'provider callback receipts are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `provider_callback_receipts_no_delete`
  BEFORE DELETE ON `provider_callback_receipts`
  BEGIN SELECT RAISE(ABORT, 'provider callback receipts are append-only'); END;
