CREATE INDEX `api_tokens_created_by_user_id_idx` ON `api_tokens` (`created_by_user_id`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_user_id_idx` ON `audit_events` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_created_by_user_id_idx` ON `workspace_invitations` (`created_by_user_id`);