CREATE TABLE `customer_directory_states` (
  `merchant_id` text PRIMARY KEY NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `state_json` text NOT NULL CHECK (json_valid(`state_json`)),
  `revision` integer DEFAULT 0 NOT NULL CHECK (`revision` >= 0),
  `updated_at` text NOT NULL
);
