CREATE TABLE `merchant_activation_states` (
  `merchant_id` text PRIMARY KEY NOT NULL REFERENCES `merchants`(`id`) ON DELETE CASCADE,
  `business_details_confirmed_at` text,
  `owner_provider_confirmed_at` text,
  `exception_review_confirmed_at` text,
  `booking_policies_json` text,
  `policies_confirmed_at` text,
  `launch_test_source_revision` text,
  `launch_test_passed_at` text,
  `first_activated_at` text,
  `revision` integer DEFAULT 1 NOT NULL CHECK (`revision` > 0),
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `merchant_activation_history` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `kind` text NOT NULL CHECK (`kind` IN ('launch_test_passed','first_published')),
  `source_revision` text NOT NULL,
  `occurred_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_activation_first_publication_once`
  ON `merchant_activation_history` (`merchant_id`,`kind`) WHERE `kind` = 'first_published';
