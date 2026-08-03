ALTER TABLE `booking_outbox` ADD `notification_intent_id` text;--> statement-breakpoint
ALTER TABLE `booking_outbox` ADD `email_attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_outbox` ADD `email_next_attempt_at` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_booking_outbox` (
	`id` text PRIMARY KEY,
	`appointment_id` text NOT NULL UNIQUE,
	`notification_intent_id` text UNIQUE,
	`kind` text NOT NULL,
	`trace_id` text NOT NULL,
	`created_at` text NOT NULL,
	`claimed_at` text,
	`email_status` text DEFAULT 'pending' NOT NULL,
	`email_failure_code` text,
	`email_attempt_count` integer DEFAULT 0 NOT NULL,
	`email_next_attempt_at` text,
	`webhook_status` text DEFAULT 'pending' NOT NULL,
	`processed_at` text,
	CONSTRAINT `fk_booking_outbox_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_booking_outbox`(`id`, `appointment_id`, `kind`, `trace_id`, `created_at`, `claimed_at`, `email_status`, `email_failure_code`, `webhook_status`, `processed_at`) SELECT `id`, `appointment_id`, `kind`, `trace_id`, `created_at`, `claimed_at`, `email_status`, `email_failure_code`, `webhook_status`, `processed_at` FROM `booking_outbox`;--> statement-breakpoint
DROP TABLE `booking_outbox`;--> statement-breakpoint
ALTER TABLE `__new_booking_outbox` RENAME TO `booking_outbox`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `booking_outbox_pending_idx` ON `booking_outbox` (`processed_at`,`created_at`);
--> statement-breakpoint
UPDATE `booking_outbox`
SET `email_status` = CASE
      WHEN `email_status` = 'skipped' THEN 'needs_configuration'
      WHEN `email_status` = 'failed' THEN 'failed_retryable'
      ELSE `email_status`
    END,
    `processed_at` = CASE
      WHEN `email_status` IN ('skipped', 'failed') THEN NULL
      ELSE `processed_at`
    END;
--> statement-breakpoint
INSERT INTO `notification_intents` (`id`, `shop_id`, `topic`, `recipient_json`, `payload_json`, `source_type`, `source_id`, `deduplication_key`, `status`, `available_at`, `created_at`, `updated_at`)
SELECT 'nti_' || substr(o.`id`, 5),
       COALESCE(p.`shop_id`, (SELECT s.`id` FROM `shops` s WHERE s.`merchant_id` = a.`merchant_id` ORDER BY s.`created_at` LIMIT 1)),
       'appointment.confirmed',
       json_object('email', json_extract(a.`snapshot`, '$.customerDetails.email')),
       json_object(
         'appointmentId', a.`id`,
         'snapshot', json(a.`snapshot`),
         'confirmationRouteId', (SELECT c.`route_id` FROM `confirmation_access` c WHERE c.`appointment_id` = a.`id` LIMIT 1)
       ),
       'appointment', a.`id`, 'appointment.confirmed:' || a.`id`,
       CASE
         WHEN o.`processed_at` IS NULL THEN 'pending'
         WHEN o.`webhook_status` = 'dead_lettered' OR o.`email_status` = 'failed_terminal' THEN 'failed'
         WHEN o.`email_status` = 'disabled' THEN 'cancelled'
         WHEN o.`email_status` = 'delivered' AND o.`webhook_status` = 'completed' THEN 'delivered'
         ELSE 'pending'
       END,
       o.`created_at`, o.`created_at`, COALESCE(o.`processed_at`, o.`created_at`)
FROM `booking_outbox` o
JOIN `appointments` a ON a.`id` = o.`appointment_id`
LEFT JOIN `booking_parties` p ON p.`id` = a.`booking_party_id`
WHERE COALESCE(p.`shop_id`, (SELECT s.`id` FROM `shops` s WHERE s.`merchant_id` = a.`merchant_id` ORDER BY s.`created_at` LIMIT 1)) IS NOT NULL
ON CONFLICT (`deduplication_key`) DO NOTHING;
--> statement-breakpoint
UPDATE `booking_outbox`
SET `notification_intent_id` = 'nti_' || substr(`id`, 5)
WHERE EXISTS (SELECT 1 FROM `notification_intents` n WHERE n.`id` = 'nti_' || substr(`booking_outbox`.`id`, 5));
