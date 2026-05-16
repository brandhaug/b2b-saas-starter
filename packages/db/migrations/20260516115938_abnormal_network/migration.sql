CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_account_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text,
	CONSTRAINT `fk_api_tokens_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_api_tokens_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY,
	`workspace_id` text,
	`actor_user_id` text,
	`event_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_audit_events_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_audit_events_actor_user_id_user_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_refresh_runs` (
	`id` text PRIMARY KEY,
	`workspace_id` text,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`summary` text NOT NULL,
	CONSTRAINT `fk_catalog_refresh_runs_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `implementation_reports` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_implementation_reports_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text NOT NULL,
	`connected_at` text,
	`last_checked_at` text,
	CONSTRAINT `fk_integration_connections_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY,
	`workspace_id` text,
	`user_id` text,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_notifications_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `report_schedules` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`frequency` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`recipients` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_report_schedules_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`impersonatedBy` text,
	CONSTRAINT `fk_session_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `starter_modules` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`category` text NOT NULL,
	`docs_path` text NOT NULL,
	`optional` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`image` text,
	`username` text UNIQUE,
	`displayUsername` text,
	`emailVerified` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'user',
	`banned` integer DEFAULT false,
	`banReason` text,
	`banExpires` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY,
	`endpoint_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`next_attempt_at` text,
	`response_status` integer,
	CONSTRAINT `fk_webhook_deliveries_endpoint_id_webhook_endpoints_id_fk` FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`signing_secret` text NOT NULL,
	`signing_secret_hash` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`events` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_webhook_endpoints_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_invitations` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text,
	CONSTRAINT `fk_workspace_invitations_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_invitations_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `workspace_members_pk` PRIMARY KEY(`workspace_id`, `user_id`),
	CONSTRAINT `fk_workspace_members_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_members_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_module_states` (
	`workspace_id` text NOT NULL,
	`module_id` text NOT NULL,
	`status` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`missing_config` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `workspace_module_states_pk` PRIMARY KEY(`workspace_id`, `module_id`),
	CONSTRAINT `fk_workspace_module_states_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_module_states_module_id_starter_modules_id_fk` FOREIGN KEY (`module_id`) REFERENCES `starter_modules`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`plan_id` text DEFAULT 'starter' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`user_id`);