CREATE TABLE `personal_data_exports` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`archive` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT `fk_personal_data_exports_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_personal_data_exports_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `personal_data_exports_expiry_idx` ON `personal_data_exports` (`expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `personal_data_exports_user_id_idx` ON `personal_data_exports` (`user_id`);