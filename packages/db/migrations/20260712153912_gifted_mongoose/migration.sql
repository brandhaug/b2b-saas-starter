CREATE TABLE `payment_reconciliation_events` (
	`id` text PRIMARY KEY,
	`payment_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`received_at` text NOT NULL,
	CONSTRAINT `fk_payment_reconciliation_events_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `method` text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `pricing_quote_id` text REFERENCES pricing_quotes(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `payments` ADD `amount_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `payments_booking_party_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_reconciliation_provider_event_unique` ON `payment_reconciliation_events` (`provider`,`provider_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transactions_provider_fact_unique` ON `payment_transactions` (`kind`,`provider_reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_booking_party_id_unique` ON `payments` (`booking_party_id`);--> statement-breakpoint
CREATE INDEX `payments_pricing_quote_id_idx` ON `payments` (`pricing_quote_id`);