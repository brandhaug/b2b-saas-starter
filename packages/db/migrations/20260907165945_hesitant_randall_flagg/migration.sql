ALTER TABLE `oauth_client` ADD `ssoSessionId` text REFERENCES session(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `workspace_sso_connections` ADD `autoJoin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_sso_connections` ADD `domainVerified` integer DEFAULT false NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account` (
	`id` text PRIMARY KEY,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`issuer` text NOT NULL,
	`userId` text,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_account_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_account`(`id`, `accountId`, `providerId`, `issuer`, `userId`, `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`, `password`, `createdAt`, `updatedAt`) SELECT `id`, `accountId`, `providerId`, `issuer`, `userId`, `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`, `password`, `createdAt`, `updatedAt` FROM `account`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace_sso_connections` (
	`id` text PRIMARY KEY,
	`issuer` text NOT NULL,
	`oidcConfig` text,
	`samlConfig` text,
	`userId` text,
	`providerId` text NOT NULL UNIQUE,
	`workspaceId` text NOT NULL,
	`domain` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`requireSso` integer DEFAULT false NOT NULL,
	`autoJoin` integer DEFAULT false NOT NULL,
	`domainVerified` integer DEFAULT false NOT NULL,
	`defaultWorkspaceRole` text DEFAULT 'member' NOT NULL,
	`connectionGeneration` integer DEFAULT 1 NOT NULL,
	`lastLoginTestedAt` integer,
	`lastLoginTestedBy` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_workspace_sso_connections_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_workspace_sso_connections_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_workspace_sso_connections`(`id`, `issuer`, `oidcConfig`, `samlConfig`, `userId`, `providerId`, `workspaceId`, `domain`, `enabled`, `requireSso`, `defaultWorkspaceRole`, `connectionGeneration`, `lastLoginTestedAt`, `lastLoginTestedBy`, `createdAt`) SELECT `id`, `issuer`, `oidcConfig`, `samlConfig`, `userId`, `providerId`, `workspaceId`, `domain`, `enabled`, `requireSso`, `defaultWorkspaceRole`, `connectionGeneration`, `lastLoginTestedAt`, `lastLoginTestedBy`, `createdAt` FROM `workspace_sso_connections`;--> statement-breakpoint
DROP TABLE `workspace_sso_connections`;--> statement-breakpoint
ALTER TABLE `__new_workspace_sso_connections` RENAME TO `workspace_sso_connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_uidx` ON `account` (`issuer`,`accountId`);--> statement-breakpoint
CREATE INDEX `workspace_sso_connections_workspace_id_idx` ON `workspace_sso_connections` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `workspace_sso_connections_domain_idx` ON `workspace_sso_connections` (`domain`);