CREATE TABLE `webhook_investigation_tasks` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`record` text NOT NULL,
	`replay_delivery_id` text,
	`transition_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_webhook_investigation_tasks_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `webhook_investigation_tasks_workspace_idx` ON `webhook_investigation_tasks` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_investigation_tasks_replay_idx` ON `webhook_investigation_tasks` (`replay_delivery_id`);