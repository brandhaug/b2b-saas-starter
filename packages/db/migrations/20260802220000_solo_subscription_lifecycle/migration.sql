ALTER TABLE `merchant_subscriptions` ADD `owner_user_id` text REFERENCES `user`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `merchant_subscriptions` ADD `interval` text DEFAULT 'monthly' NOT NULL CHECK (`interval` IN ('monthly','annual'));--> statement-breakpoint
ALTER TABLE `merchant_subscriptions` ADD `restricted_at` text;--> statement-breakpoint
ALTER TABLE `merchant_subscriptions` ADD `retention_ends_at` text;--> statement-breakpoint
ALTER TABLE `merchant_subscriptions` ADD `retention_disposed_at` text;--> statement-breakpoint
ALTER TABLE `merchant_subscriptions` ADD `pending_interval` text CHECK (`pending_interval` IN ('monthly','annual'));--> statement-breakpoint
ALTER TABLE `merchant_subscriptions` ADD `pending_change_at` text;--> statement-breakpoint

CREATE TABLE `merchant_subscription_trial_claims` (
  `owner_user_id` text PRIMARY KEY NOT NULL REFERENCES `user`(`id`) ON DELETE RESTRICT,
  `merchant_id` text NOT NULL UNIQUE REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `idempotency_key` text NOT NULL UNIQUE,
  `request_fingerprint` text NOT NULL,
  `claimed_at` text NOT NULL
);--> statement-breakpoint

CREATE TABLE `merchant_subscription_events` (
  `event_id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `kind` text NOT NULL,
  `occurred_at` text NOT NULL,
  `evidence_json` text NOT NULL,
  `received_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `merchant_subscription_events_projection_idx` ON `merchant_subscription_events` (`merchant_id`,`occurred_at`,`event_id`);--> statement-breakpoint

CREATE TABLE `merchant_subscription_unmatched_events` (
  `event_id` text PRIMARY KEY NOT NULL,
  `event_type` text NOT NULL,
  `reason` text NOT NULL,
  `received_at` text NOT NULL,
  `merchant_id` text REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `occurred_at` text,
  `provider_customer_ref` text,
  `provider_subscription_ref` text,
  `refund_kind` text CHECK (`refund_kind` IN ('full-refund','partial-refund')),
  `reconciled_at` text
);--> statement-breakpoint

CREATE TABLE `merchant_subscription_price_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `event_id` text NOT NULL UNIQUE REFERENCES `merchant_subscription_events`(`event_id`) ON DELETE RESTRICT,
  `price_id` text NOT NULL,
  `interval` text NOT NULL CHECK (`interval` IN ('monthly','annual')),
  `amount_minor` integer NOT NULL,
  `currency` text NOT NULL CHECK (`currency` = 'EUR'),
  `excludes_vat` integer DEFAULT 1 NOT NULL CHECK (`excludes_vat` = 1),
  `recorded_at` text NOT NULL
);--> statement-breakpoint

CREATE TABLE `merchant_subscription_retention_dispositions` (
  `merchant_id` text PRIMARY KEY NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `kind` text NOT NULL CHECK (`kind` = 'merchant-operational-data-disposed'),
  `policy_version` text NOT NULL,
  `summary_json` text NOT NULL,
  `disposed_at` text NOT NULL
);--> statement-breakpoint

CREATE TABLE `merchant_subscription_notices` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `kind` text NOT NULL,
  `cycle_key` text NOT NULL,
  `effective_at` text NOT NULL,
  `acknowledged_at` text,
  `created_at` text NOT NULL,
  UNIQUE(`merchant_id`,`kind`,`cycle_key`)
);--> statement-breakpoint
