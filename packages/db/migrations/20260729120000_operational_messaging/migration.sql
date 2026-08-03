ALTER TABLE `notification_intents` ADD `purpose` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `phase` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `result` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `result_reason` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `locale` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `trace_id` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `destination_id` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `template_version_id` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `rate_card_id` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `terminal_at` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `superseded_at` text;
--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `superseded_after_submission` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_intents_id_shop_unique`
  ON `notification_intents` (`id`, `shop_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_intents_semantic_source_unique`
  ON `notification_intents`
  (`shop_id`, `source_type`, `source_id`, `source_version`, `purpose`, `deduplication_key`);
--> statement-breakpoint
CREATE INDEX `notification_intents_phase_available_idx`
  ON `notification_intents` (`phase`, `available_at`);
--> statement-breakpoint
CREATE TABLE `messaging_rate_cards` (
  `id` text PRIMARY KEY NOT NULL,
  `version` integer NOT NULL,
  `currency` text NOT NULL,
  `charge_milli_euro` integer NOT NULL,
  `effective_at` text NOT NULL,
  `notice_published_at` text,
  `retired_at` text,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_rate_cards_version_unique` UNIQUE (`version`),
  CONSTRAINT `messaging_rate_cards_charge_identity_unique`
    UNIQUE (`id`, `charge_milli_euro`),
  CONSTRAINT `messaging_rate_cards_amount_positive` CHECK (`charge_milli_euro` > 0),
  CONSTRAINT `messaging_rate_cards_eur_only` CHECK (`currency` = 'EUR')
);
--> statement-breakpoint
INSERT INTO `messaging_rate_cards`
  (`id`, `version`, `currency`, `charge_milli_euro`, `effective_at`, `created_at`)
VALUES
  ('mrcard_launch_v1', 1, 'EUR', 45, '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z');
--> statement-breakpoint
CREATE TABLE `protected_messaging_destinations` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `intent_id` text NOT NULL,
  `ciphertext` text,
  `key_version` integer NOT NULL,
  `fingerprint` text,
  `masked_value` text,
  `country_code` text NOT NULL,
  `created_at` text NOT NULL,
  `erased_at` text,
  CONSTRAINT `protected_messaging_destinations_intent_unique` UNIQUE (`intent_id`),
  CONSTRAINT `protected_messaging_destinations_fingerprint_scope_unique`
    UNIQUE (`shop_id`, `fingerprint`, `intent_id`),
  CONSTRAINT `protected_messaging_destinations_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE CASCADE,
  CONSTRAINT `protected_messaging_destinations_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `protected_messaging_destinations_erasure_check`
    CHECK ((`erased_at` IS NULL AND `ciphertext` IS NOT NULL AND
            `fingerprint` IS NOT NULL AND `masked_value` IS NOT NULL) OR
           (`erased_at` IS NOT NULL AND `ciphertext` IS NULL AND
            `fingerprint` IS NULL AND `masked_value` IS NULL))
);
--> statement-breakpoint
CREATE INDEX `protected_messaging_destinations_lookup_idx`
  ON `protected_messaging_destinations` (`shop_id`, `fingerprint`);
--> statement-breakpoint
CREATE TABLE `messaging_template_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `purpose` text NOT NULL,
  `locale` text NOT NULL,
  `channel` text NOT NULL,
  `version` integer NOT NULL,
  `body_fingerprint` text NOT NULL,
  `provider_template_key` text,
  `effective_at` text NOT NULL,
  `retired_at` text,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_template_versions_identity_unique`
    UNIQUE (`purpose`, `locale`, `channel`, `version`),
  CONSTRAINT `messaging_template_versions_purpose_check`
    CHECK (`purpose` IN (
      'appointment_confirmation',
      'appointment_reminder',
      'appointment_cancellation',
      'appointment_reschedule'
    )),
  CONSTRAINT `messaging_template_versions_locale_check`
    CHECK (`locale` IN ('ro', 'en')),
  CONSTRAINT `messaging_template_versions_channel_check`
    CHECK (`channel` IN ('whatsapp', 'sms'))
);
--> statement-breakpoint
CREATE TABLE `notification_intent_controlled_facts` (
  `intent_id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `template_version_id` text NOT NULL,
  `facts_json` text NOT NULL,
  `facts_fingerprint` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `erased_at` text,
  CONSTRAINT `notification_intent_controlled_facts_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE CASCADE,
  CONSTRAINT `notification_intent_controlled_facts_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `notification_intent_controlled_facts_template_fk`
    FOREIGN KEY (`template_version_id`) REFERENCES `messaging_template_versions` (`id`)
);
--> statement-breakpoint
CREATE TABLE `delivery_routes` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `intent_id` text NOT NULL,
  `ordinal` integer NOT NULL,
  `channel` text NOT NULL,
  `provider` text NOT NULL,
  `state` text NOT NULL,
  `ineligible_reason` text,
  `accepted_at` text,
  `delivered_at` text,
  `terminal_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `delivery_routes_id_shop_unique` UNIQUE (`id`, `shop_id`),
  CONSTRAINT `delivery_routes_id_shop_intent_unique`
    UNIQUE (`id`, `shop_id`, `intent_id`),
  CONSTRAINT `delivery_routes_intent_ordinal_unique` UNIQUE (`intent_id`, `ordinal`),
  CONSTRAINT `delivery_routes_intent_channel_unique` UNIQUE (`intent_id`, `channel`),
  CONSTRAINT `delivery_routes_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE CASCADE,
  CONSTRAINT `delivery_routes_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `delivery_routes_ordinal_check` CHECK (`ordinal` >= 0),
  CONSTRAINT `delivery_routes_pair_check`
    CHECK ((`channel` = 'whatsapp' AND `provider` = 'meta') OR
           (`channel` = 'sms' AND `provider` = 'smso')),
  CONSTRAINT `delivery_routes_state_check`
    CHECK (`state` IN (
      'planned',
      'eligible',
      'submitting',
      'accepted',
      'delivered',
      'ineligible',
      'submission_unknown',
      'terminal_failure'
    ))
);
--> statement-breakpoint
CREATE INDEX `delivery_routes_intent_state_idx`
  ON `delivery_routes` (`intent_id`, `state`);
--> statement-breakpoint
CREATE TABLE `submission_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `intent_id` text NOT NULL,
  `route_id` text NOT NULL,
  `ordinal` integer NOT NULL,
  `idempotency_key` text NOT NULL,
  `request_fingerprint` text NOT NULL,
  `state` text NOT NULL,
  `started_at` text NOT NULL,
  `completed_at` text,
  `created_at` text NOT NULL,
  CONSTRAINT `submission_attempts_id_shop_unique` UNIQUE (`id`, `shop_id`),
  CONSTRAINT `submission_attempts_id_shop_intent_unique`
    UNIQUE (`id`, `shop_id`, `intent_id`),
  CONSTRAINT `submission_attempts_id_shop_intent_route_unique`
    UNIQUE (`id`, `shop_id`, `intent_id`, `route_id`),
  CONSTRAINT `submission_attempts_route_ordinal_unique` UNIQUE (`route_id`, `ordinal`),
  CONSTRAINT `submission_attempts_idempotency_unique` UNIQUE (`idempotency_key`),
  CONSTRAINT `submission_attempts_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE CASCADE,
  CONSTRAINT `submission_attempts_route_intent_shop_fk`
    FOREIGN KEY (`route_id`, `shop_id`, `intent_id`)
    REFERENCES `delivery_routes` (`id`, `shop_id`, `intent_id`) ON DELETE CASCADE,
  CONSTRAINT `submission_attempts_ordinal_check` CHECK (`ordinal` >= 0),
  CONSTRAINT `submission_attempts_state_check`
    CHECK (`state` IN (
      'prepared',
      'submitting',
      'captured',
      'accepted',
      'rejected_retryable',
      'rejected_terminal',
      'submission_unknown'
    ))
);
--> statement-breakpoint
CREATE INDEX `submission_attempts_intent_idx`
  ON `submission_attempts` (`intent_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `submission_outcomes` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `intent_id` text NOT NULL,
  `route_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `outcome` text NOT NULL,
  `observed_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `submission_outcomes_attempt_unique` UNIQUE (`attempt_id`),
  CONSTRAINT `submission_outcomes_attempt_route_intent_shop_fk`
    FOREIGN KEY (`attempt_id`, `shop_id`, `intent_id`, `route_id`)
    REFERENCES `submission_attempts` (`id`, `shop_id`, `intent_id`, `route_id`) ON DELETE CASCADE,
  CONSTRAINT `submission_outcomes_outcome_check`
    CHECK (`outcome` IN (
      'captured',
      'accepted',
      'rejected_retryable',
      'rejected_terminal',
      'submission_unknown'
    ))
);
--> statement-breakpoint
CREATE INDEX `submission_outcomes_intent_idx`
  ON `submission_outcomes` (`intent_id`, `observed_at`);
--> statement-breakpoint
CREATE TABLE `protected_provider_references` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `environment` text NOT NULL,
  `provider` text NOT NULL,
  `provider_account_key` text NOT NULL,
  `reference_type` text NOT NULL,
  `ciphertext` text,
  `key_version` integer NOT NULL,
  `fingerprint` text NOT NULL,
  `masked_suffix` text,
  `created_at` text NOT NULL,
  `erased_at` text,
  CONSTRAINT `protected_provider_references_attempt_unique`
    UNIQUE (`attempt_id`, `reference_type`),
  CONSTRAINT `protected_provider_references_source_unique`
    UNIQUE (`environment`, `provider`, `provider_account_key`, `reference_type`, `fingerprint`),
  CONSTRAINT `protected_provider_references_attempt_shop_fk`
    FOREIGN KEY (`attempt_id`, `shop_id`)
    REFERENCES `submission_attempts` (`id`, `shop_id`) ON DELETE CASCADE,
  CONSTRAINT `protected_provider_references_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `protected_provider_references_erasure_check`
    CHECK ((`erased_at` IS NULL AND `ciphertext` IS NOT NULL) OR
           (`erased_at` IS NOT NULL AND `ciphertext` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `provider_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `intent_id` text NOT NULL,
  `route_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `environment` text NOT NULL,
  `provider` text NOT NULL,
  `provider_account_key` text NOT NULL,
  `source` text NOT NULL,
  `source_event_key` text NOT NULL,
  `provider_reference_fingerprint` text,
  `status` text NOT NULL,
  `trusted` integer NOT NULL,
  `normalized_code` text,
  `body_fingerprint` text,
  `provider_occurred_at` text,
  `observed_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `provider_evidence_source_identity_unique`
    UNIQUE (`environment`, `provider`, `provider_account_key`, `source`, `source_event_key`),
  CONSTRAINT `provider_evidence_attempt_route_intent_shop_fk`
    FOREIGN KEY (`attempt_id`, `shop_id`, `intent_id`, `route_id`)
    REFERENCES `submission_attempts` (`id`, `shop_id`, `intent_id`, `route_id`)
    ON DELETE CASCADE,
  CONSTRAINT `provider_evidence_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE CASCADE,
  CONSTRAINT `provider_evidence_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `provider_evidence_source_check`
    CHECK (`source` IN ('response', 'callback', 'query', 'operator')),
  CONSTRAINT `provider_evidence_status_check`
    CHECK (`status` IN (
      'captured',
      'accepted',
      'rejected_retryable',
      'rejected_terminal',
      'submission_unknown',
      'delivered',
      'read',
      'terminal_failure'
    )),
  CONSTRAINT `provider_evidence_trusted_check` CHECK (`trusted` IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `provider_evidence_projection_idx`
  ON `provider_evidence` (`intent_id`, `observed_at`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_evidence_message_status_unique`
  ON `provider_evidence`
  (`environment`, `provider`, `provider_account_key`,
   `provider_reference_fingerprint`, `status`)
  WHERE `provider_reference_fingerprint` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `provider_evidence_no_update`
  BEFORE UPDATE ON `provider_evidence`
  BEGIN SELECT RAISE(ABORT, 'provider evidence is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `provider_evidence_no_delete`
  BEFORE DELETE ON `provider_evidence`
  BEGIN SELECT RAISE(ABORT, 'provider evidence is append-only'); END;
--> statement-breakpoint
CREATE TABLE `suppression_directives` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text,
  `destination_fingerprint` text NOT NULL,
  `scope` text NOT NULL,
  `source` text NOT NULL,
  `source_identity` text NOT NULL,
  `reason_code` text NOT NULL,
  `effective_at` text NOT NULL,
  `expires_at` text,
  `revoked_at` text,
  `created_at` text NOT NULL,
  CONSTRAINT `suppression_directives_source_unique`
    UNIQUE (`source`, `source_identity`),
  CONSTRAINT `suppression_directives_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `suppression_directives_scope_check`
    CHECK (`scope` IN ('all_operational', 'whatsapp', 'sms'))
);
--> statement-breakpoint
CREATE INDEX `suppression_directives_eligibility_idx`
  ON `suppression_directives`
  (`destination_fingerprint`, `shop_id`, `scope`, `effective_at`, `expires_at`, `revoked_at`);
--> statement-breakpoint
CREATE TABLE `messaging_channel_controls` (
  `id` text PRIMARY KEY NOT NULL,
  `environment` text NOT NULL,
  `channel` text NOT NULL,
  `provider` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `reason` text,
  `changed_by_operator_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `messaging_channel_controls_scope_unique`
    UNIQUE (`environment`, `channel`, `provider`),
  CONSTRAINT `messaging_channel_controls_enabled_check` CHECK (`enabled` IN (0, 1)),
  CONSTRAINT `messaging_channel_controls_pair_check`
    CHECK ((`channel` = 'whatsapp' AND `provider` = 'meta') OR
           (`channel` = 'sms' AND `provider` = 'smso'))
);
--> statement-breakpoint
CREATE TABLE `merchant_messaging_controls` (
  `shop_id` text PRIMARY KEY NOT NULL,
  `enabled` integer DEFAULT 0 NOT NULL,
  `confirmation_enabled` integer DEFAULT 1 NOT NULL,
  `reminder_enabled` integer DEFAULT 1 NOT NULL,
  `cancellation_enabled` integer DEFAULT 1 NOT NULL,
  `reschedule_enabled` integer DEFAULT 1 NOT NULL,
  `reminder_lead_minutes` integer,
  `frozen` integer DEFAULT 0 NOT NULL,
  `freeze_reason` text,
  `low_balance_notice_armed` integer DEFAULT 1 NOT NULL,
  `policy_version` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `merchant_messaging_controls_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `merchant_messaging_controls_boolean_check`
    CHECK (`enabled` IN (0, 1) AND
           `confirmation_enabled` IN (0, 1) AND
           `reminder_enabled` IN (0, 1) AND
           `cancellation_enabled` IN (0, 1) AND
           `reschedule_enabled` IN (0, 1) AND
           `frozen` IN (0, 1) AND
           `low_balance_notice_armed` IN (0, 1)),
  CONSTRAINT `merchant_messaging_controls_reminder_check`
    CHECK (`reminder_lead_minutes` IS NULL OR `reminder_lead_minutes` > 0)
);
--> statement-breakpoint
CREATE TABLE `notification_intent_leases` (
  `intent_id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `owner_id` text NOT NULL,
  `lease_token` text NOT NULL,
  `leased_until` text NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `last_recovered_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `notification_intent_leases_token_unique` UNIQUE (`lease_token`),
  CONSTRAINT `notification_intent_leases_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE CASCADE,
  CONSTRAINT `notification_intent_leases_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `notification_intent_leases_attempt_count_check` CHECK (`attempt_count` >= 0)
);
--> statement-breakpoint
CREATE INDEX `notification_intent_leases_expiry_idx`
  ON `notification_intent_leases` (`leased_until`);
--> statement-breakpoint
CREATE TABLE `messaging_balances` (
  `shop_id` text PRIMARY KEY NOT NULL,
  `currency` text DEFAULT 'EUR' NOT NULL,
  `financially_frozen` integer DEFAULT 0 NOT NULL,
  `freeze_reason` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `messaging_balances_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `messaging_balances_currency_check` CHECK (`currency` = 'EUR'),
  CONSTRAINT `messaging_balances_frozen_check` CHECK (`financially_frozen` IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `messaging_balance_reservations` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `intent_id` text NOT NULL,
  `rate_card_id` text NOT NULL,
  `amount_milli_euro` integer NOT NULL,
  `status` text NOT NULL,
  `expires_at` text NOT NULL,
  `converted_at` text,
  `released_at` text,
  `release_reason` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `messaging_balance_reservations_intent_unique` UNIQUE (`intent_id`),
  CONSTRAINT `messaging_balance_reservations_id_shop_unique` UNIQUE (`id`, `shop_id`),
  CONSTRAINT `messaging_balance_reservations_id_shop_intent_unique`
    UNIQUE (`id`, `shop_id`, `intent_id`),
  CONSTRAINT `messaging_balance_reservations_charge_snapshot_unique`
    UNIQUE (`id`, `shop_id`, `intent_id`, `rate_card_id`, `amount_milli_euro`),
  CONSTRAINT `messaging_balance_reservations_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE CASCADE,
  CONSTRAINT `messaging_balance_reservations_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `messaging_balances` (`shop_id`) ON DELETE CASCADE,
  CONSTRAINT `messaging_balance_reservations_rate_card_fk`
    FOREIGN KEY (`rate_card_id`) REFERENCES `messaging_rate_cards` (`id`),
  CONSTRAINT `messaging_balance_reservations_rate_amount_fk`
    FOREIGN KEY (`rate_card_id`, `amount_milli_euro`)
    REFERENCES `messaging_rate_cards` (`id`, `charge_milli_euro`),
  CONSTRAINT `messaging_balance_reservations_amount_positive` CHECK (`amount_milli_euro` > 0),
  CONSTRAINT `messaging_balance_reservations_status_check`
    CHECK (`status` IN ('active', 'converted', 'released'))
);
--> statement-breakpoint
CREATE INDEX `messaging_balance_reservations_active_idx`
  ON `messaging_balance_reservations` (`shop_id`, `status`, `expires_at`);
--> statement-breakpoint
CREATE TABLE `messaging_balance_ledger_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `direction` text NOT NULL,
  `kind` text NOT NULL,
  `amount_milli_euro` integer NOT NULL,
  `currency` text DEFAULT 'EUR' NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `rate_card_id` text,
  `intent_id` text,
  `actor_type` text,
  `actor_id` text,
  `reason` text,
  `fiscal_reference` text,
  `reverses_entry_id` text,
  `correction_reason` text,
  `occurred_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_balance_ledger_source_unique`
    UNIQUE (`source_type`, `source_id`, `idempotency_key`),
  CONSTRAINT `messaging_balance_ledger_reversal_unique`
    UNIQUE (`reverses_entry_id`, `correction_reason`),
  CONSTRAINT `messaging_balance_ledger_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `messaging_balances` (`shop_id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_balance_ledger_rate_card_fk`
    FOREIGN KEY (`rate_card_id`) REFERENCES `messaging_rate_cards` (`id`),
  CONSTRAINT `messaging_balance_ledger_rate_amount_fk`
    FOREIGN KEY (`rate_card_id`, `amount_milli_euro`)
    REFERENCES `messaging_rate_cards` (`id`, `charge_milli_euro`),
  CONSTRAINT `messaging_balance_ledger_intent_fk`
    FOREIGN KEY (`intent_id`) REFERENCES `notification_intents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_balance_ledger_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_balance_ledger_reverses_fk`
    FOREIGN KEY (`reverses_entry_id`) REFERENCES `messaging_balance_ledger_entries` (`id`),
  CONSTRAINT `messaging_balance_ledger_amount_positive` CHECK (`amount_milli_euro` > 0),
  CONSTRAINT `messaging_balance_ledger_currency_check` CHECK (`currency` = 'EUR'),
  CONSTRAINT `messaging_balance_ledger_direction_check` CHECK (`direction` IN ('credit', 'debit')),
  CONSTRAINT `messaging_balance_ledger_kind_check`
    CHECK (`kind` IN (
      'top_up',
      'delivery_charge',
      'operator_adjustment',
      'refund',
      'correction',
      'promotional_credit'
    )),
  CONSTRAINT `messaging_balance_ledger_reversal_check`
    CHECK ((`reverses_entry_id` IS NULL AND `correction_reason` IS NULL) OR
           (`reverses_entry_id` IS NOT NULL AND `correction_reason` IS NOT NULL)),
  CONSTRAINT `messaging_balance_ledger_delivery_charge_check`
    CHECK (`kind` <> 'delivery_charge' OR
           (`intent_id` IS NOT NULL AND `rate_card_id` IS NOT NULL AND
            `direction` = 'debit'))
);
--> statement-breakpoint
CREATE INDEX `messaging_balance_ledger_statement_idx`
  ON `messaging_balance_ledger_entries` (`shop_id`, `occurred_at`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `messaging_balance_ledger_delivery_charge_intent_unique`
  ON `messaging_balance_ledger_entries` (`intent_id`)
  WHERE `kind` = 'delivery_charge';
--> statement-breakpoint
CREATE TRIGGER `messaging_balance_ledger_no_update`
  BEFORE UPDATE ON `messaging_balance_ledger_entries`
  BEGIN SELECT RAISE(ABORT, 'messaging balance ledger is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `messaging_balance_ledger_no_delete`
  BEFORE DELETE ON `messaging_balance_ledger_entries`
  BEGIN SELECT RAISE(ABORT, 'messaging balance ledger is append-only'); END;
--> statement-breakpoint
CREATE TABLE `chargeable_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `intent_id` text NOT NULL,
  `reservation_id` text NOT NULL,
  `rate_card_id` text NOT NULL,
  `route_id` text NOT NULL,
  `charge_milli_euro` integer NOT NULL,
  `verified_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `chargeable_deliveries_intent_unique` UNIQUE (`intent_id`),
  CONSTRAINT `chargeable_deliveries_reservation_unique` UNIQUE (`reservation_id`),
  CONSTRAINT `chargeable_deliveries_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE RESTRICT,
  CONSTRAINT `chargeable_deliveries_reservation_snapshot_fk`
    FOREIGN KEY (`reservation_id`, `shop_id`, `intent_id`, `rate_card_id`,
                 `charge_milli_euro`)
    REFERENCES `messaging_balance_reservations`
      (`id`, `shop_id`, `intent_id`, `rate_card_id`, `amount_milli_euro`)
    ON DELETE RESTRICT,
  CONSTRAINT `chargeable_deliveries_rate_card_fk`
    FOREIGN KEY (`rate_card_id`) REFERENCES `messaging_rate_cards` (`id`),
  CONSTRAINT `chargeable_deliveries_route_intent_shop_fk`
    FOREIGN KEY (`route_id`, `shop_id`, `intent_id`)
    REFERENCES `delivery_routes` (`id`, `shop_id`, `intent_id`) ON DELETE RESTRICT,
  CONSTRAINT `chargeable_deliveries_amount_positive` CHECK (`charge_milli_euro` > 0)
);
--> statement-breakpoint
CREATE TABLE `provider_messaging_costs` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `intent_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `environment` text NOT NULL,
  `provider` text NOT NULL,
  `provider_account_key` text NOT NULL,
  `billing_identity_fingerprint` text NOT NULL,
  `unit_ordinal` integer NOT NULL,
  `amount_minor_units` integer NOT NULL,
  `currency` text NOT NULL,
  `currency_scale` integer NOT NULL,
  `units` integer NOT NULL,
  `source` text NOT NULL,
  `recorded_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `provider_messaging_costs_billing_unit_unique`
    UNIQUE (`environment`, `provider`, `provider_account_key`,
            `billing_identity_fingerprint`, `unit_ordinal`),
  CONSTRAINT `provider_messaging_costs_attempt_intent_shop_fk`
    FOREIGN KEY (`attempt_id`, `shop_id`, `intent_id`)
    REFERENCES `submission_attempts` (`id`, `shop_id`, `intent_id`) ON DELETE RESTRICT,
  CONSTRAINT `provider_messaging_costs_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE RESTRICT,
  CONSTRAINT `provider_messaging_costs_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `provider_messaging_costs_amount_check` CHECK (`amount_minor_units` >= 0),
  CONSTRAINT `provider_messaging_costs_scale_check`
    CHECK (`currency_scale` >= 0 AND `currency_scale` <= 9),
  CONSTRAINT `provider_messaging_costs_units_check` CHECK (`units` > 0),
  CONSTRAINT `provider_messaging_costs_source_check`
    CHECK (`source` IN ('response', 'callback', 'query', 'invoice'))
);
--> statement-breakpoint
CREATE INDEX `provider_messaging_costs_intent_idx`
  ON `provider_messaging_costs` (`intent_id`, `recorded_at`);
--> statement-breakpoint
CREATE TABLE `messaging_reconciliation_cases` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text,
  `intent_id` text,
  `kind` text NOT NULL,
  `source_identity` text NOT NULL,
  `status` text NOT NULL,
  `severity` text NOT NULL,
  `safe_summary` text NOT NULL,
  `assigned_operator_id` text,
  `resolution_classification` text,
  `resolution_source` text,
  `resolution_reason` text,
  `opened_at` text NOT NULL,
  `resolved_at` text,
  `waived_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `messaging_reconciliation_cases_source_unique`
    UNIQUE (`kind`, `source_identity`),
  CONSTRAINT `messaging_reconciliation_cases_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE SET NULL,
  CONSTRAINT `messaging_reconciliation_cases_intent_fk`
    FOREIGN KEY (`intent_id`) REFERENCES `notification_intents` (`id`) ON DELETE SET NULL,
  CONSTRAINT `messaging_reconciliation_cases_intent_shop_fk`
    FOREIGN KEY (`intent_id`, `shop_id`)
    REFERENCES `notification_intents` (`id`, `shop_id`) ON DELETE SET NULL,
  CONSTRAINT `messaging_reconciliation_cases_status_check`
    CHECK (`status` IN ('open', 'investigating', 'resolved', 'waived')),
  CONSTRAINT `messaging_reconciliation_cases_severity_check`
    CHECK (`severity` IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT `messaging_reconciliation_cases_intent_scope_check`
    CHECK (`intent_id` IS NULL OR `shop_id` IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `messaging_reconciliation_cases_queue_idx`
  ON `messaging_reconciliation_cases` (`status`, `severity`, `opened_at`);
--> statement-breakpoint
CREATE TABLE `messaging_incidents` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text,
  `provider` text,
  `channel` text,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `severity` text NOT NULL,
  `safe_summary` text NOT NULL,
  `containment_scope` text NOT NULL,
  `opened_by_actor_type` text NOT NULL,
  `opened_by_actor_id` text NOT NULL,
  `opened_at` text NOT NULL,
  `resolved_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `messaging_incidents_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE SET NULL,
  CONSTRAINT `messaging_incidents_status_check`
    CHECK (`status` IN ('open', 'contained', 'recovering', 'resolved')),
  CONSTRAINT `messaging_incidents_severity_check`
    CHECK (`severity` IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT `messaging_incidents_containment_check`
    CHECK (`containment_scope` IN (
      'merchant',
      'provider_channel',
      'callback_rule',
      'global'
    ))
);
--> statement-breakpoint
CREATE INDEX `messaging_incidents_queue_idx`
  ON `messaging_incidents` (`status`, `severity`, `opened_at`);
--> statement-breakpoint
CREATE TABLE `messaging_retention_tombstones` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text,
  `resource_type` text NOT NULL,
  `resource_id` text NOT NULL,
  `action` text NOT NULL,
  `status` text NOT NULL,
  `due_at` text NOT NULL,
  `lease_owner` text,
  `leased_until` text,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `last_failure_code` text,
  `completed_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `messaging_retention_tombstones_resource_unique`
    UNIQUE (`resource_type`, `resource_id`, `action`),
  CONSTRAINT `messaging_retention_tombstones_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE SET NULL,
  CONSTRAINT `messaging_retention_tombstones_action_check`
    CHECK (`action` IN ('erase_destination', 'erase_provider_reference', 'erase_facts', 'delete_quarantine')),
  CONSTRAINT `messaging_retention_tombstones_status_check`
    CHECK (`status` IN ('pending', 'leased', 'completed', 'failed')),
  CONSTRAINT `messaging_retention_tombstones_attempt_count_check` CHECK (`attempt_count` >= 0)
);
--> statement-breakpoint
CREATE INDEX `messaging_retention_tombstones_due_idx`
  ON `messaging_retention_tombstones` (`status`, `due_at`);
--> statement-breakpoint
CREATE VIEW `merchant_notification_delivery_summaries` AS
SELECT
  ni.id AS intent_id,
  ni.shop_id,
  ni.source_type,
  ni.source_id,
  ni.source_version,
  ni.purpose,
  ni.phase,
  ni.result,
  ni.result_reason,
  ni.available_at,
  ni.terminal_at,
  pmd.masked_value AS masked_destination,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM messaging_reconciliation_cases mrc
      WHERE mrc.intent_id = ni.id AND mrc.status IN ('open', 'investigating')
    ) THEN 1 ELSE 0
  END AS under_review
FROM notification_intents ni
LEFT JOIN protected_messaging_destinations pmd ON pmd.intent_id = ni.id;
--> statement-breakpoint
CREATE VIEW `merchant_messaging_balance_summaries` AS
SELECT
  mb.shop_id,
  mb.currency,
  COALESCE(SUM(
    CASE
      WHEN mle.direction = 'credit' THEN mle.amount_milli_euro
      WHEN mle.direction = 'debit' THEN -mle.amount_milli_euro
      ELSE 0
    END
  ), 0) AS posted_milli_euro,
  COALESCE((
    SELECT SUM(mbr.amount_milli_euro)
    FROM messaging_balance_reservations mbr
    WHERE mbr.shop_id = mb.shop_id AND mbr.status = 'active'
  ), 0) AS reserved_milli_euro,
  COALESCE(SUM(
    CASE
      WHEN mle.direction = 'credit' THEN mle.amount_milli_euro
      WHEN mle.direction = 'debit' THEN -mle.amount_milli_euro
      ELSE 0
    END
  ), 0) - COALESCE((
    SELECT SUM(mbr.amount_milli_euro)
    FROM messaging_balance_reservations mbr
    WHERE mbr.shop_id = mb.shop_id AND mbr.status = 'active'
  ), 0) AS available_milli_euro,
  mb.financially_frozen
FROM messaging_balances mb
LEFT JOIN messaging_balance_ledger_entries mle ON mle.shop_id = mb.shop_id
GROUP BY mb.shop_id, mb.currency, mb.financially_frozen;
--> statement-breakpoint
CREATE VIEW `operations_messaging_case_summaries` AS
SELECT
  mrc.id AS case_id,
  mrc.shop_id,
  mrc.intent_id,
  mrc.kind,
  mrc.status,
  mrc.severity,
  mrc.safe_summary,
  mrc.opened_at,
  mrc.resolved_at,
  ni.purpose,
  ni.phase AS intent_phase,
  ni.result AS intent_result,
  pmd.masked_value AS masked_destination
FROM messaging_reconciliation_cases mrc
LEFT JOIN notification_intents ni
  ON ni.id = mrc.intent_id AND ni.shop_id = mrc.shop_id
LEFT JOIN protected_messaging_destinations pmd
  ON pmd.intent_id = mrc.intent_id AND pmd.shop_id = mrc.shop_id;
--> statement-breakpoint
CREATE VIEW `operations_messaging_route_summaries` AS
SELECT
  dr.id AS route_id,
  dr.shop_id,
  dr.intent_id,
  dr.ordinal,
  dr.channel,
  dr.provider,
  dr.state,
  dr.ineligible_reason,
  dr.accepted_at,
  dr.delivered_at,
  dr.terminal_at,
  (
    SELECT pe.status
    FROM provider_evidence pe
    WHERE pe.route_id = dr.id AND pe.shop_id = dr.shop_id
    ORDER BY pe.observed_at DESC, pe.id DESC
    LIMIT 1
  ) AS latest_evidence_status,
  (
    SELECT pe.observed_at
    FROM provider_evidence pe
    WHERE pe.route_id = dr.id AND pe.shop_id = dr.shop_id
    ORDER BY pe.observed_at DESC, pe.id DESC
    LIMIT 1
  ) AS latest_evidence_observed_at,
  (
    SELECT COUNT(*)
    FROM submission_attempts sa
    WHERE sa.route_id = dr.id AND sa.shop_id = dr.shop_id
  ) AS attempt_count
FROM delivery_routes dr;
--> statement-breakpoint
CREATE VIEW `operations_messaging_charge_summaries` AS
SELECT
  cd.id AS charge_id,
  cd.shop_id,
  cd.intent_id,
  cd.route_id,
  cd.charge_milli_euro,
  cd.verified_at,
  mle.id AS ledger_entry_id
FROM chargeable_deliveries cd
LEFT JOIN messaging_balance_ledger_entries mle
  ON mle.intent_id = cd.intent_id
  AND mle.shop_id = cd.shop_id
  AND mle.kind = 'delivery_charge';
--> statement-breakpoint
CREATE VIEW `operations_messaging_provider_cost_summaries` AS
SELECT
  pmc.id AS cost_id,
  pmc.shop_id,
  pmc.intent_id,
  pmc.attempt_id,
  pmc.provider,
  pmc.amount_minor_units,
  pmc.currency,
  pmc.currency_scale,
  pmc.units,
  pmc.source,
  pmc.recorded_at
FROM provider_messaging_costs pmc;
--> statement-breakpoint
CREATE VIEW `operations_messaging_incident_summaries` AS
SELECT
  mi.id AS incident_id,
  mi.shop_id,
  mi.provider,
  mi.channel,
  mi.kind,
  mi.status,
  mi.severity,
  mi.safe_summary,
  mi.containment_scope,
  mi.opened_at,
  mi.resolved_at
FROM messaging_incidents mi;
--> statement-breakpoint
CREATE VIEW `operations_messaging_channel_control_summaries` AS
SELECT
  mcc.id AS control_id,
  mcc.environment,
  mcc.channel,
  mcc.provider,
  mcc.enabled,
  mcc.reason,
  mcc.updated_at
FROM messaging_channel_controls mcc;
