CREATE TABLE `workspace_sso_connections` (
	`id` text PRIMARY KEY,
	`issuer` text NOT NULL,
	`oidcConfig` text,
	`samlConfig` text,
	`userId` text NOT NULL,
	`providerId` text NOT NULL UNIQUE,
	`workspaceId` text NOT NULL,
	`domain` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`requireSso` integer DEFAULT false NOT NULL,
	`defaultWorkspaceRole` text DEFAULT 'member' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_workspace_sso_connections_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_sso_connections_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `workspace_sso_connections_workspace_id_idx` ON `workspace_sso_connections` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `workspace_sso_connections_domain_idx` ON `workspace_sso_connections` (`domain`);