CREATE TABLE `reschedule_commands` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`reschedule_session_id` text NOT NULL UNIQUE,
	`from_version` integer NOT NULL,
	`to_version` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`committed_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_reschedule_commands_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reschedule_commands_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reschedule_commands_reschedule_session_id_reschedule_sessions_id_fk` FOREIGN KEY (`reschedule_session_id`) REFERENCES `reschedule_sessions`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `reschedule_sessions` (
	`id` text PRIMARY KEY,
	`appointment_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`booking_session_id` text NOT NULL UNIQUE,
	`booking_party_id` text NOT NULL UNIQUE,
	`purpose` text DEFAULT 'appointment_reschedule' NOT NULL,
	`capability_hash` text NOT NULL UNIQUE,
	`base_appointment_version` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`hold_id` text UNIQUE,
	`replacement_provider_id` text,
	`replacement_starts_at` text,
	`replacement_ends_at` text,
	`hold_expires_at` text,
	`pricing_quote_id` text,
	`pricing_quote_version` integer,
	`replacement_total_minor` integer,
	`replacement_currency` text,
	`quote_accepted_at` text,
	`quote_expires_at` text,
	`policy_id` text,
	`policy_version` integer,
	`policy_disclosure_snapshot` text,
	`policy_accepted_at` text,
	`settlement_kind` text,
	`settlement_amount_minor` integer,
	`settlement_reference_id` text,
	`reminder_at` text,
	`expires_at` text NOT NULL,
	`committed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_reschedule_sessions_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reschedule_sessions_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reschedule_sessions_booking_session_id_booking_sessions_id_fk` FOREIGN KEY (`booking_session_id`) REFERENCES `booking_sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reschedule_sessions_replacement_provider_id_providers_id_fk` FOREIGN KEY (`replacement_provider_id`) REFERENCES `providers`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "reschedule_sessions_positive_base_version" CHECK("base_appointment_version" > 0)
);
--> statement-breakpoint
ALTER TABLE `appointment_cancellations` ADD `appointment_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_intents` ADD `source_version` integer;--> statement-breakpoint
ALTER TABLE `scheduled_work` ADD `source_type` text;--> statement-breakpoint
ALTER TABLE `scheduled_work` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `scheduled_work` ADD `source_version` integer;--> statement-breakpoint
UPDATE `notification_intents`
SET `source_version` = 1
WHERE `source_type` = 'appointment' AND `source_version` IS NULL;--> statement-breakpoint
UPDATE `scheduled_work`
SET `source_type` = 'appointment',
	`source_id` = json_extract(`payload_json`, '$.appointmentId'),
	`source_version` = COALESCE(json_extract(`payload_json`, '$.appointmentVersion'), 1)
WHERE `kind` = 'appointment.reminder' AND `source_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `reschedule_commands_idempotency_unique` ON `reschedule_commands` (`merchant_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `reschedule_commands_appointment_version_unique` ON `reschedule_commands` (`appointment_id`,`from_version`);--> statement-breakpoint
CREATE INDEX `reschedule_sessions_appointment_status_idx` ON `reschedule_sessions` (`appointment_id`,`status`);
--> statement-breakpoint
CREATE TRIGGER `reschedule_commands_current_version_guard`
BEFORE INSERT ON `reschedule_commands`
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1
		FROM `appointments` AS a
		JOIN `reschedule_sessions` AS s ON s.`id` = NEW.`reschedule_session_id`
		WHERE a.`id` = NEW.`appointment_id`
			AND a.`merchant_id` = NEW.`merchant_id`
			AND a.`status` = 'scheduled'
			AND a.`version` = NEW.`from_version`
			AND s.`appointment_id` = a.`id`
			AND s.`merchant_id` = a.`merchant_id`
			AND s.`purpose` = 'appointment_reschedule'
			AND s.`status` = 'active'
			AND s.`base_appointment_version` = a.`version`
			AND s.`expires_at` > NEW.`committed_at`
			AND s.`hold_id` IS NOT NULL
			AND s.`pricing_quote_id` IS NOT NULL
			AND s.`quote_accepted_at` IS NOT NULL
			AND s.`policy_id` IS NOT NULL
			AND s.`policy_accepted_at` IS NOT NULL
	) THEN RAISE(ABORT, 'reschedule_version_conflict') END;
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1
		FROM `reschedule_sessions` AS s
		JOIN `time_slot_holds` AS h ON h.`id` = s.`hold_id`
		JOIN `pricing_quotes` AS q ON q.`id` = s.`pricing_quote_id`
		JOIN `pricing_quote_acceptances` AS qa ON qa.`pricing_quote_id` = q.`id`
		JOIN `policy_acceptances` AS pa ON pa.`booking_party_id` = s.`booking_party_id` AND pa.`checkout_policy_id` = s.`policy_id`
		JOIN `checkout_policies` AS p ON p.`id` = pa.`checkout_policy_id`
		WHERE s.`id` = NEW.`reschedule_session_id`
			AND h.`booking_session_id` = s.`booking_session_id`
			AND h.`merchant_id` = s.`merchant_id`
			AND h.`provider_id` = s.`replacement_provider_id`
			AND h.`starts_at` = s.`replacement_starts_at`
			AND h.`ends_at` = s.`replacement_ends_at`
			AND h.`expires_at` = s.`hold_expires_at`
			AND h.`expires_at` > NEW.`committed_at`
			AND q.`booking_party_id` = s.`booking_party_id`
			AND q.`version` = s.`pricing_quote_version`
			AND q.`total_minor` = s.`replacement_total_minor`
			AND q.`currency` = s.`replacement_currency`
			AND q.`accepted_at` = s.`quote_accepted_at`
			AND q.`expires_at` = s.`quote_expires_at`
			AND q.`expires_at` > NEW.`committed_at`
			AND qa.`booking_party_id` = s.`booking_party_id`
			AND p.`version` = s.`policy_version`
			AND pa.`disclosure_snapshot` = s.`policy_disclosure_snapshot`
			AND pa.`accepted_at` = s.`policy_accepted_at`
	) THEN RAISE(ABORT, 'reschedule_facts_conflict') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `reschedule_sessions` AS s
		WHERE s.`id` = NEW.`reschedule_session_id`
			AND s.`settlement_kind` = 'additional_collection'
			AND NOT EXISTS (
				SELECT 1 FROM `payments` AS pay
				WHERE pay.`id` = s.`settlement_reference_id`
					AND pay.`booking_party_id` = s.`booking_party_id`
					AND pay.`currency` = s.`replacement_currency`
					AND pay.`status` = 'captured'
					AND pay.`captured_minor` >= s.`settlement_amount_minor`
			)
	) THEN RAISE(ABORT, 'reschedule_settlement_conflict') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `reschedule_sessions` AS s
		WHERE s.`id` = NEW.`reschedule_session_id`
			AND s.`settlement_kind` = 'refund'
			AND NOT EXISTS (
				SELECT 1 FROM `refund_obligations` AS r
				WHERE r.`id` = s.`settlement_reference_id`
					AND r.`appointment_id` = NEW.`appointment_id`
					AND r.`currency` = s.`replacement_currency`
					AND r.`amount_minor` = s.`settlement_amount_minor`
					AND r.`status` IN ('pending', 'failed_retryable')
			)
	) THEN RAISE(ABORT, 'reschedule_settlement_conflict') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1
		FROM `appointments` AS conflict
		JOIN `reschedule_sessions` AS s ON s.`id` = NEW.`reschedule_session_id`
		WHERE conflict.`id` <> NEW.`appointment_id`
			AND conflict.`status` = 'scheduled'
			AND conflict.`provider_id` = s.`replacement_provider_id`
			AND conflict.`starts_at` < s.`replacement_ends_at`
			AND conflict.`ends_at` > s.`replacement_starts_at`
	) THEN RAISE(ABORT, 'reschedule_slot_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_cancellations_current_version_guard`
BEFORE INSERT ON `appointment_cancellations`
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1
		FROM `appointments` AS a
		WHERE a.`id` = NEW.`appointment_id`
			AND a.`status` = 'scheduled'
			AND a.`version` = NEW.`appointment_version`
	) THEN RAISE(ABORT, 'appointment_version_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER `reschedule_booking_party_cannot_create_appointment`
BEFORE INSERT ON `appointments`
WHEN EXISTS (
	SELECT 1 FROM `reschedule_sessions` AS s
	WHERE s.`booking_party_id` = NEW.`booking_party_id`
)
BEGIN
	SELECT RAISE(ABORT, 'reschedule_session_cannot_confirm_new_appointment');
END;
