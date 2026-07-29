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
CREATE TABLE `messaging_retention_holds` (
  `id` text PRIMARY KEY NOT NULL,
  `resource_type` text NOT NULL,
  `resource_id` text NOT NULL,
  `purpose` text NOT NULL,
  `status` text NOT NULL,
  `reason` text NOT NULL,
  `placed_by_operator_id` text NOT NULL,
  `placed_at` text NOT NULL,
  `released_by_operator_id` text,
  `released_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `messaging_retention_holds_status_check`
    CHECK (`status` IN ('active', 'released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messaging_retention_holds_active_resource_unique`
  ON `messaging_retention_holds` (`resource_type`, `resource_id`, `purpose`)
  WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX `messaging_retention_holds_resource_idx`
  ON `messaging_retention_holds` (`resource_type`, `resource_id`, `status`);
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
  `operator_session_id` text NOT NULL,
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
--> statement-breakpoint
CREATE TABLE `messaging_callback_rejection_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `incident_id` text NOT NULL,
  `environment` text NOT NULL,
  `provider` text NOT NULL,
  `rule_key` text NOT NULL,
  `enabled` integer NOT NULL,
  `reason` text NOT NULL,
  `changed_by_operator_id` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `messaging_callback_rejection_rules_incident_fk`
    FOREIGN KEY (`incident_id`) REFERENCES `messaging_incidents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_callback_rejection_rules_scope_unique`
    UNIQUE (`environment`, `provider`, `rule_key`),
  CONSTRAINT `messaging_callback_rejection_rules_enabled_check`
    CHECK (`enabled` IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `messaging_callback_rejection_rules_active_idx`
  ON `messaging_callback_rejection_rules` (`environment`, `provider`, `enabled`);
--> statement-breakpoint
CREATE TABLE `messaging_recovery_checks` (
  `id` text PRIMARY KEY NOT NULL,
  `incident_id` text NOT NULL,
  `kind` text NOT NULL,
  `reference` text NOT NULL,
  `status` text NOT NULL,
  `observed_at` text NOT NULL,
  `actor_operator_id` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_recovery_checks_incident_fk`
    FOREIGN KEY (`incident_id`) REFERENCES `messaging_incidents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_recovery_checks_incident_kind_reference_unique`
    UNIQUE (`incident_id`, `kind`, `reference`),
  CONSTRAINT `messaging_recovery_checks_kind_check`
    CHECK (`kind` IN ('health_probe', 'reconciliation')),
  CONSTRAINT `messaging_recovery_checks_status_check`
    CHECK (`status` IN ('passed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `messaging_recovery_checks_incident_status_idx`
  ON `messaging_recovery_checks` (`incident_id`, `kind`, `status`);
--> statement-breakpoint
CREATE TABLE `messaging_key_rotations` (
  `id` text PRIMARY KEY NOT NULL,
  `incident_id` text NOT NULL,
  `kind` text NOT NULL,
  `environment` text NOT NULL,
  `provider` text,
  `channel` text,
  `previous_version` text NOT NULL,
  `next_version` text NOT NULL,
  `invalidated_at` text NOT NULL,
  `validated_at` text NOT NULL,
  `evidence_reference` text NOT NULL,
  `actor_operator_id` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_key_rotations_incident_fk`
    FOREIGN KEY (`incident_id`) REFERENCES `messaging_incidents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_key_rotations_incident_kind_unique`
    UNIQUE (`incident_id`, `kind`),
  CONSTRAINT `messaging_key_rotations_kind_check`
    CHECK (`kind` IN ('provider_credential', 'destination_encryption', 'provider_reference')),
  CONSTRAINT `messaging_key_rotations_provider_check`
    CHECK (`provider` IS NULL OR `provider` IN ('meta', 'smso')),
  CONSTRAINT `messaging_key_rotations_channel_check`
    CHECK (`channel` IS NULL OR `channel` IN ('whatsapp', 'sms')),
  CONSTRAINT `messaging_key_rotations_versions_differ_check`
    CHECK (`previous_version` <> `next_version`)
);
