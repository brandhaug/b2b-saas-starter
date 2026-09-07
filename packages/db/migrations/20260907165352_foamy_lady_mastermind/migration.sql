ALTER TABLE `workspace_sso_connections` ADD `connectionGeneration` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_sso_connections` ADD `lastLoginTestedAt` integer;--> statement-breakpoint
ALTER TABLE `workspace_sso_connections` ADD `lastLoginTestedBy` text;