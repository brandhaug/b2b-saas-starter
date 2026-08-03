PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cancellation_commands` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`scope` text NOT NULL,
	`target_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`result_json` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_cancellation_commands_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_cancellation_commands`(`id`, `merchant_id`, `scope`, `target_id`, `idempotency_key`, `result_json`, `created_at`) SELECT `id`, `merchant_id`, `scope`, `target_id`, `idempotency_key`, `result_json`, `created_at` FROM `cancellation_commands`;--> statement-breakpoint
DROP TABLE `cancellation_commands`;--> statement-breakpoint
ALTER TABLE `__new_cancellation_commands` RENAME TO `cancellation_commands`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `cancellation_commands_idempotency_unique` ON `cancellation_commands` (`merchant_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `cancellation_commands_target_unique` ON `cancellation_commands` (`merchant_id`,`scope`,`target_id`);--> statement-breakpoint
CREATE INDEX `cancellation_commands_merchant_idx` ON `cancellation_commands` (`merchant_id`);