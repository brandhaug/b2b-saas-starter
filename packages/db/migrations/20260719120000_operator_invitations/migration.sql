CREATE TABLE `operator_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`roles_json` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by_operator_id` text NOT NULL,
	`accepted_operator_id` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`accepted_at` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`invited_by_operator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operator_invitations_token_hash_unique` ON `operator_invitations` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `operator_invitations_email_idx` ON `operator_invitations` (`email`);
--> statement-breakpoint
CREATE INDEX `operator_invitations_expiry_idx` ON `operator_invitations` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `operator_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`invitation_id` text NOT NULL,
	`operator_id` text NOT NULL,
	`session_token_hash` text NOT NULL,
	`session_expires_at` integer NOT NULL,
	`password_set_at` integer NOT NULL,
	`email_verified_at` integer NOT NULL,
	`totp_verified_at` integer,
	`backup_codes_confirmed_at` integer,
	`completed_at` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `operator_invitations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operator_enrollments_session_token_hash_unique` ON `operator_enrollments` (`session_token_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operator_enrollments_invitation_idx` ON `operator_enrollments` (`invitation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operator_enrollments_operator_idx` ON `operator_enrollments` (`operator_id`);
