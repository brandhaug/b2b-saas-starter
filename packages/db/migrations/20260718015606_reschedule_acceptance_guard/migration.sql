DROP TRIGGER IF EXISTS `reschedule_commands_current_version_guard`;
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
			AND qa.`accepted_at` = s.`quote_accepted_at`
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
