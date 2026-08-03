-- Value-free replay authority. Deploy to the PRIVACY_LEDGER D1 binding and
-- exclude it from primary Merchant-data point-in-time restores.
CREATE TABLE `privacy_action_ledger` (
  `id` text PRIMARY KEY NOT NULL,
  `privacy_request_id` text NOT NULL,
  `action_key` text NOT NULL UNIQUE,
  `action_kind` text NOT NULL,
  `resource_type` text NOT NULL,
  `resource_ref` text NOT NULL,
  `outcome` text NOT NULL CHECK (`outcome` IN ('pending','applied','held','failed')),
  `policy_version` text NOT NULL,
  `applied_at` text,
  `created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `privacy_action_ledger_replay_idx`
ON `privacy_action_ledger` (`outcome`,`created_at`);
