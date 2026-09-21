ALTER TABLE `assistant_conversations` ADD `run_access_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DROP TRIGGER assistant_membership_removed;
--> statement-breakpoint
CREATE TRIGGER assistant_membership_removed AFTER DELETE ON workspace_members BEGIN
  DELETE FROM personal_data_exports WHERE user_id=OLD.userId;
  UPDATE assistant_conversations SET policy_revision=policy_revision+1,run_access_revision=run_access_revision+1 WHERE creator_user_id=OLD.userId AND workspace_id=OLD.workspaceId AND deleted_at IS NULL;
END;

--> statement-breakpoint
DROP TRIGGER assistant_membership_role_changed;
--> statement-breakpoint
CREATE TRIGGER assistant_membership_role_changed AFTER UPDATE OF role ON workspace_members WHEN OLD.role <> NEW.role BEGIN
  DELETE FROM personal_data_exports WHERE user_id=OLD.userId;
  UPDATE assistant_conversations SET policy_revision=policy_revision+1,run_access_revision=run_access_revision+1 WHERE creator_user_id=OLD.userId AND workspace_id=OLD.workspaceId AND deleted_at IS NULL;
END;

--> statement-breakpoint
DROP TRIGGER assistant_workspace_suspension;
--> statement-breakpoint
CREATE TRIGGER assistant_workspace_suspension AFTER UPDATE OF suspensionStatus ON workspaces WHEN OLD.suspensionStatus <> NEW.suspensionStatus BEGIN
  DELETE FROM personal_data_exports WHERE user_id IN (SELECT creator_user_id FROM assistant_conversations WHERE workspace_id=NEW.id);
  UPDATE assistant_conversations SET policy_revision=policy_revision+1,run_access_revision=run_access_revision+1 WHERE workspace_id=NEW.id AND deleted_at IS NULL;
END;
