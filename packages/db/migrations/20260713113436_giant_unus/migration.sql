CREATE TABLE `refund_obligation_events` (
	`id` text PRIMARY KEY,
	`refund_obligation_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`outcome` text NOT NULL,
	`failure_code` text,
	`expected_attempt_count` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_refund_obligation_events_refund_obligation_id_refund_obligations_id_fk` FOREIGN KEY (`refund_obligation_id`) REFERENCES `refund_obligations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_obligation_events_provider_event_unique` ON `refund_obligation_events` (`provider_event_id`);--> statement-breakpoint
CREATE INDEX `refund_obligation_events_obligation_idx` ON `refund_obligation_events` (`refund_obligation_id`,`occurred_at`);--> statement-breakpoint
CREATE TRIGGER `appointment_cancellations_scheduled_guard`
BEFORE INSERT ON `appointment_cancellations`
WHEN COALESCE((SELECT `status` FROM `appointments` WHERE `id` = NEW.`appointment_id`), 'missing') <> 'scheduled'
BEGIN
  SELECT RAISE(ABORT, 'appointment_not_scheduled');
END;--> statement-breakpoint
CREATE TRIGGER `refund_obligation_events_transition_guard`
BEFORE INSERT ON `refund_obligation_events`
WHEN COALESCE((SELECT `status` FROM `refund_obligations` WHERE `id` = NEW.`refund_obligation_id`), 'missing') IN ('succeeded', 'failed_terminal')
  OR COALESCE((SELECT `attempt_count` FROM `refund_obligations` WHERE `id` = NEW.`refund_obligation_id`), -1) <> NEW.`expected_attempt_count`
BEGIN
  SELECT RAISE(ABORT, 'refund_obligation_transition_conflict');
END;
