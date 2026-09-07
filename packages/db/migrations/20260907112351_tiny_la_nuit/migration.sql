CREATE TABLE `email_deliveries` (
	`id` text PRIMARY KEY,
	`reference_id` text,
	`purpose` text NOT NULL,
	`recipient` text NOT NULL,
	`user_id` text,
	`workspace_id` text,
	`status` text NOT NULL,
	`provider_message_id` text,
	`last_event_id` text,
	`last_event_at` text,
	`reason` text,
	`accepted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`retry_until` text NOT NULL,
	`next_attempt_at` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`uncertain` integer NOT NULL,
	`token` text,
	`revision` integer NOT NULL,
	CONSTRAINT `fk_email_deliveries_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_email_deliveries_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `email_deliveries_user_idx` ON `email_deliveries` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_deliveries_workspace_idx` ON `email_deliveries` (`workspace_id`,`purpose`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_deliveries_provider_idx` ON `email_deliveries` (`provider_message_id`,`recipient`);