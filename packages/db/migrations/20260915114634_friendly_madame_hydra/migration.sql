CREATE TABLE `assistant_conversations` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`creator_user_id` text NOT NULL,
	`required_permissions` text DEFAULT '[]' NOT NULL,
	`policy_revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	`cleaned_at` text
);
--> statement-breakpoint
CREATE TABLE `assistant_reservations` (
	`id` text PRIMARY KEY,
	`conversation_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`deadline` integer NOT NULL,
	`committed_at` integer,
	`released_at` integer
);
--> statement-breakpoint
CREATE TABLE `assistant_session_authority` (
	`session_id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`impersonated_by` text,
	`password_verified_at` integer,
	`strong_auth_at` integer,
	`strong_auth_method` text,
	`strong_auth_credential_id` text,
	`recovery_until` integer,
	CONSTRAINT `fk_assistant_session_authority_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `personal_data_exports` ADD `conversation_manifest` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `assistant_conversations_owner_idx` ON `assistant_conversations` (`workspace_id`,`creator_user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `assistant_conversations_creator_idx` ON `assistant_conversations` (`creator_user_id`);--> statement-breakpoint
CREATE INDEX `assistant_conversations_cleanup_idx` ON `assistant_conversations` (`deleted_at`,`cleaned_at`);--> statement-breakpoint
CREATE INDEX `assistant_reservations_member_idx` ON `assistant_reservations` (`workspace_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `assistant_reservations_conversation_idx` ON `assistant_reservations` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `assistant_session_authority_user_idx` ON `assistant_session_authority` (`user_id`);--> statement-breakpoint
CREATE TRIGGER assistant_session_authority_insert AFTER INSERT ON session BEGIN
  INSERT OR IGNORE INTO assistant_session_authority (session_id,user_id,expires_at,impersonated_by,password_verified_at,strong_auth_at,strong_auth_method,strong_auth_credential_id,recovery_until)
  VALUES (NEW.id,NEW.userId,NEW.expiresAt,NEW.impersonatedBy,NEW.passwordVerifiedAt,NEW.strongAuthAt,NEW.strongAuthMethod,NEW.strongAuthCredentialId,NEW.recoveryUntil);
END;
--> statement-breakpoint
CREATE TRIGGER assistant_session_authority_update AFTER UPDATE ON session BEGIN
  UPDATE assistant_session_authority SET expires_at=NEW.expiresAt, impersonated_by=NEW.impersonatedBy, password_verified_at=NEW.passwordVerifiedAt, strong_auth_at=NEW.strongAuthAt, strong_auth_method=NEW.strongAuthMethod, strong_auth_credential_id=NEW.strongAuthCredentialId, recovery_until=NEW.recoveryUntil WHERE session_id=NEW.id;
END;
--> statement-breakpoint
INSERT INTO assistant_session_authority (session_id,user_id,expires_at,impersonated_by,password_verified_at,strong_auth_at,strong_auth_method,strong_auth_credential_id,recovery_until)
SELECT id,userId,expiresAt,impersonatedBy,passwordVerifiedAt,strongAuthAt,strongAuthMethod,strongAuthCredentialId,recoveryUntil FROM session;

--> statement-breakpoint
CREATE TRIGGER assistant_user_deletion BEFORE DELETE ON user BEGIN
  DELETE FROM personal_data_exports WHERE user_id IN (SELECT creator_user_id FROM assistant_conversations WHERE creator_user_id=OLD.id);
  UPDATE assistant_conversations SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),policy_revision=policy_revision+1 WHERE creator_user_id=OLD.id AND deleted_at IS NULL;
  UPDATE assistant_reservations SET released_at=unixepoch('subsec')*1000 WHERE conversation_id IN (SELECT id FROM assistant_conversations WHERE creator_user_id=OLD.id) AND released_at IS NULL;
END;

--> statement-breakpoint
CREATE TRIGGER assistant_workspaces_deletion BEFORE DELETE ON workspaces BEGIN
  DELETE FROM personal_data_exports WHERE user_id IN (SELECT creator_user_id FROM assistant_conversations WHERE workspace_id=OLD.id);
  UPDATE assistant_conversations SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),policy_revision=policy_revision+1 WHERE workspace_id=OLD.id AND deleted_at IS NULL;
  UPDATE assistant_reservations SET released_at=unixepoch('subsec')*1000 WHERE conversation_id IN (SELECT id FROM assistant_conversations WHERE workspace_id=OLD.id) AND released_at IS NULL;
END;

--> statement-breakpoint
CREATE TRIGGER assistant_membership_removed AFTER DELETE ON workspace_members BEGIN
  DELETE FROM personal_data_exports WHERE user_id=OLD.userId;
  UPDATE assistant_conversations SET policy_revision=policy_revision+1 WHERE creator_user_id=OLD.userId AND workspace_id=OLD.workspaceId AND deleted_at IS NULL;
END;

--> statement-breakpoint
CREATE TRIGGER assistant_membership_role_changed AFTER UPDATE OF role ON workspace_members BEGIN
  DELETE FROM personal_data_exports WHERE user_id=OLD.userId;
  UPDATE assistant_conversations SET policy_revision=policy_revision+1 WHERE creator_user_id=OLD.userId AND workspace_id=OLD.workspaceId AND deleted_at IS NULL;
END;

--> statement-breakpoint
CREATE TRIGGER assistant_workspace_suspension AFTER UPDATE OF suspensionStatus ON workspaces WHEN OLD.suspensionStatus <> NEW.suspensionStatus BEGIN
  DELETE FROM personal_data_exports WHERE user_id IN (SELECT creator_user_id FROM assistant_conversations WHERE workspace_id=NEW.id);
  UPDATE assistant_conversations SET policy_revision=policy_revision+1 WHERE workspace_id=NEW.id AND deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_conversation_parent_guard BEFORE INSERT ON assistant_conversations WHEN NEW.deleted_at IS NULL BEGIN
  SELECT RAISE(ABORT, 'assistant_parent_missing') WHERE NOT EXISTS (SELECT 1 FROM user WHERE id=NEW.creator_user_id) OR NOT EXISTS (SELECT 1 FROM workspaces WHERE id=NEW.workspace_id);
END;
