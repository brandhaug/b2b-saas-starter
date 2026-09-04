CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_notification_preferences_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `kind` text DEFAULT 'announcement' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_user_kind_idx` ON `notification_preferences` (`user_id`,`kind`);