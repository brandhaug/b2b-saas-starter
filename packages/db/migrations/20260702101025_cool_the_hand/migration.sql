PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_tokens` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`scopes` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text,
	CONSTRAINT `fk_api_tokens_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_api_tokens_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_api_tokens`(`id`, `workspace_id`, `name`, `token_prefix`, `token_hash`, `scopes`, `last_used_at`, `revoked_at`, `created_at`, `created_by_user_id`) SELECT `id`, `workspace_id`, `name`, `token_prefix`, `token_hash`, `scopes`, `last_used_at`, `revoked_at`, `created_at`, `created_by_user_id` FROM `api_tokens`;--> statement-breakpoint
DROP TABLE `api_tokens`;--> statement-breakpoint
ALTER TABLE `__new_api_tokens` RENAME TO `api_tokens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `api_tokens_workspace_id_idx` ON `api_tokens` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `audit_events_workspace_created_at_idx` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `implementation_reports_workspace_id_idx` ON `implementation_reports` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `integration_connections_workspace_id_idx` ON `integration_connections` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `notifications_workspace_id_idx` ON `notifications` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `report_schedules_workspace_id_idx` ON `report_schedules` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_endpoint_id_idx` ON `webhook_deliveries` (`endpoint_id`);--> statement-breakpoint
CREATE INDEX `webhook_endpoints_workspace_id_idx` ON `webhook_endpoints` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_workspace_id_idx` ON `workspace_invitations` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `webhook_endpoints` DROP COLUMN `signing_secret_hash`;