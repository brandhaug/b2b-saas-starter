CREATE TABLE `messaging_job_cursors` (
  `job_name` text PRIMARY KEY NOT NULL,
  `cursor_value` text NOT NULL,
  `lease_owner` text,
  `leased_until` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messaging_reconciliation_resolutions` (
  `id` text PRIMARY KEY NOT NULL,
  `case_id` text NOT NULL,
  `disposition` text NOT NULL,
  `classification` text NOT NULL,
  `source` text NOT NULL,
  `reason` text NOT NULL,
  `actor_operator_id` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_reconciliation_resolutions_case_fk`
    FOREIGN KEY (`case_id`) REFERENCES `messaging_reconciliation_cases` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_reconciliation_resolutions_case_unique` UNIQUE (`case_id`),
  CONSTRAINT `messaging_reconciliation_resolutions_disposition_check`
    CHECK (`disposition` IN ('resolved', 'waived'))
);
--> statement-breakpoint
CREATE TABLE `messaging_incident_quarantine` (
  `id` text PRIMARY KEY NOT NULL,
  `incident_id` text,
  `source` text NOT NULL,
  `ciphertext` text NOT NULL,
  `key_version` integer NOT NULL,
  `body_fingerprint` text NOT NULL,
  `received_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_incident_quarantine_incident_fk`
    FOREIGN KEY (`incident_id`) REFERENCES `messaging_incidents` (`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `messaging_incident_quarantine_expiry_idx`
  ON `messaging_incident_quarantine` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `messaging_reconciliation_resolutions_actor_idx`
  ON `messaging_reconciliation_resolutions` (`actor_operator_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `messaging_incident_events` (
  `id` text PRIMARY KEY NOT NULL,
  `incident_id` text NOT NULL,
  `kind` text NOT NULL,
  `actor_operator_id` text NOT NULL,
  `reason` text NOT NULL,
  `safe_metadata` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_incident_events_incident_fk`
    FOREIGN KEY (`incident_id`) REFERENCES `messaging_incidents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_incident_events_kind_check`
    CHECK (`kind` IN ('opened', 'contained', 'recovery_started', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX `messaging_incident_events_incident_idx`
  ON `messaging_incident_events` (`incident_id`, `created_at`, `id`);
--> statement-breakpoint
CREATE TABLE `messaging_recovery_approvals` (
  `id` text PRIMARY KEY NOT NULL,
  `incident_id` text NOT NULL,
  `actor_operator_id` text NOT NULL,
  `health_probe_reference` text NOT NULL,
  `reconciliation_reference` text NOT NULL,
  `residual_risk` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_recovery_approvals_incident_fk`
    FOREIGN KEY (`incident_id`) REFERENCES `messaging_incidents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_recovery_approvals_incident_actor_unique`
    UNIQUE (`incident_id`, `actor_operator_id`)
);
--> statement-breakpoint
CREATE INDEX `messaging_recovery_approvals_incident_idx`
  ON `messaging_recovery_approvals` (`incident_id`, `created_at`);
