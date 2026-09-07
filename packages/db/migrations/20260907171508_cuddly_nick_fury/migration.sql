ALTER TABLE `workspace_sso_recovery_exceptions` ADD `granted_by` text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_sso_recovery_exceptions` ADD `session_id` text REFERENCES session(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `workspace_sso_recovery_exceptions` ADD `created_notified_at` text;--> statement-breakpoint
ALTER TABLE `workspace_sso_recovery_exceptions` ADD `used_notified_at` text;--> statement-breakpoint
ALTER TABLE `workspace_sso_recovery_exceptions` ADD `expired_notified_at` text;