CREATE TABLE `schedule_rules` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_schedule_rules_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_schedule_rules_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE CASCADE,
	CONSTRAINT "schedule_rules_valid_weekday" CHECK("weekday" between 0 and 6),
	CONSTRAINT "schedule_rules_valid_interval" CHECK("start_time" glob '[0-2][0-9]:[0-5][0-9]' AND "end_time" glob '[0-2][0-9]:[0-5][0-9]' AND "start_time" < "end_time")
);
--> statement-breakpoint
CREATE INDEX `schedule_rules_merchant_id_idx` ON `schedule_rules` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `schedule_rules_provider_id_idx` ON `schedule_rules` (`provider_id`);