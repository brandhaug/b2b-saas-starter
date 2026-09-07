CREATE TABLE `workspace_sso_auth_proofs` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`connection_generation` integer DEFAULT 1 NOT NULL,
	`authenticated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_workspace_sso_auth_proofs_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_sso_auth_proofs_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_sso_domain_claims` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`domain` text NOT NULL,
	`provider_id` text NOT NULL,
	`verification_token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`verified_at` text,
	`last_checked_at` text,
	`grace_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_workspace_sso_domain_claims_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_sso_recovery_exceptions` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	CONSTRAINT `fk_workspace_sso_recovery_exceptions_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_sso_recovery_exceptions_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_sso_auth_proofs_session_workspace_uidx` ON `workspace_sso_auth_proofs` (`session_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_sso_auth_proofs_user_workspace_idx` ON `workspace_sso_auth_proofs` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_sso_auth_proofs_expiry_idx` ON `workspace_sso_auth_proofs` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_sso_domain_claims_domain_uidx` ON `workspace_sso_domain_claims` (`domain`);--> statement-breakpoint
CREATE INDEX `workspace_sso_domain_claims_workspace_idx` ON `workspace_sso_domain_claims` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_sso_domain_claims_provider_idx` ON `workspace_sso_domain_claims` (`provider_id`);--> statement-breakpoint
CREATE INDEX `workspace_sso_recovery_exceptions_workspace_idx` ON `workspace_sso_recovery_exceptions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_sso_recovery_exceptions_user_idx` ON `workspace_sso_recovery_exceptions` (`user_id`,`expires_at`);