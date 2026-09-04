CREATE TABLE `workspace_exports` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`requested_by_user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`object_key` text,
	`size_bytes` integer,
	`download_secret` text NOT NULL,
	`failure_reason` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`expires_at` text,
	CONSTRAINT `fk_workspace_exports_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_exports_requested_by_user_id_user_id_fk` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_exports_workspace_id_idx` ON `workspace_exports` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_exports_requested_by_user_id_idx` ON `workspace_exports` (`requested_by_user_id`);