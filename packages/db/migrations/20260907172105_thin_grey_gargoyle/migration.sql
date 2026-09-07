CREATE TABLE `sso_recovery_auth_evidence` (
	`session_id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`method` text NOT NULL,
	`passkey_id` text,
	`password_account_id` text,
	`two_factor_id` text,
	`authenticated_at` text NOT NULL,
	CONSTRAINT `fk_sso_recovery_auth_evidence_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sso_recovery_auth_evidence_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sso_recovery_auth_evidence_passkey_id_passkey_id_fk` FOREIGN KEY (`passkey_id`) REFERENCES `passkey`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sso_recovery_auth_evidence_password_account_id_account_id_fk` FOREIGN KEY (`password_account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sso_recovery_auth_evidence_two_factor_id_two_factor_id_fk` FOREIGN KEY (`two_factor_id`) REFERENCES `two_factor`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_sso_connections_required_uidx` ON `workspace_sso_connections` (`workspaceId`) WHERE "workspace_sso_connections"."requireSso" = 1;