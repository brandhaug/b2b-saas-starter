CREATE TABLE `platform_api_tokens` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`name` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`scopes` text NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text,
	CONSTRAINT `fk_platform_api_tokens_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_platform_api_tokens_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE INDEX `platform_api_tokens_merchant_created_idx` ON `platform_api_tokens` (`merchant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `platform_api_tokens_created_by_user_id_idx` ON `platform_api_tokens` (`created_by_user_id`);