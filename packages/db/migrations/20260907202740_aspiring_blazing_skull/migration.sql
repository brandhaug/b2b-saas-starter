DROP INDEX IF EXISTS `oauth_client_resource_client_id_idx`;--> statement-breakpoint
CREATE INDEX `billing_notices_workspace_delivered_idx` ON `billing_notices` (`workspace_id`,`delivered_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_id_idx` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE INDEX `workspace_sso_connections_user_id_idx` ON `workspace_sso_connections` (`userId`);