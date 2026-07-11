ALTER TABLE `audit_events` ADD `merchant_id` text REFERENCES merchants(id) ON DELETE CASCADE;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_events` (
	`id` text PRIMARY KEY,
	`merchant_id` text,
	`actor_user_id` text,
	`event_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_audit_events_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_audit_events_actor_user_id_user_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_audit_events`(`id`, `actor_user_id`, `event_type`, `target_type`, `target_id`, `metadata`, `created_at`) SELECT `id`, `actor_user_id`, `event_type`, `target_type`, `target_id`, `metadata`, `created_at` FROM `audit_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `audit_events_workspace_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `api_tokens_workspace_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `api_tokens_created_by_user_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `implementation_reports_workspace_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `integration_connections_workspace_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `notifications_workspace_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `report_schedules_workspace_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `webhook_deliveries_endpoint_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `webhook_endpoints_workspace_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workspace_invitations_workspace_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workspace_invitations_created_by_user_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workspace_members_user_idx`;--> statement-breakpoint
CREATE INDEX `audit_events_merchant_created_at_idx` ON `audit_events` (`merchant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_user_id_idx` ON `audit_events` (`actor_user_id`);--> statement-breakpoint
DROP TABLE `api_tokens`;--> statement-breakpoint
DROP TABLE `catalog_refresh_runs`;--> statement-breakpoint
DROP TABLE `implementation_reports`;--> statement-breakpoint
DROP TABLE `integration_connections`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
DROP TABLE `report_schedules`;--> statement-breakpoint
DROP TABLE `starter_modules`;--> statement-breakpoint
DROP TABLE `webhook_deliveries`;--> statement-breakpoint
DROP TABLE `webhook_endpoints`;--> statement-breakpoint
DROP TABLE `workspace_invitations`;--> statement-breakpoint
DROP TABLE `workspace_members`;--> statement-breakpoint
DROP TABLE `workspace_module_states`;--> statement-breakpoint
DROP TABLE `workspaces`;