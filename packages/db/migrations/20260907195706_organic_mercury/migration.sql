CREATE TABLE `retention_progress` (
	`record_class` text PRIMARY KEY,
	`policy_digest` text NOT NULL,
	`cursor_clock` text,
	`cursor_id` text,
	`last_success_at` text,
	`last_evaluated_at` text NOT NULL,
	`has_more` integer NOT NULL,
	`failure` text
);
--> statement-breakpoint
ALTER TABLE `workspace_invitations` ADD `terminalAt` integer;--> statement-breakpoint
CREATE INDEX `api_tokens_replaced_by_idx` ON `api_tokens` (`replaced_by_token_id`);--> statement-breakpoint
CREATE INDEX `api_tokens_retention_idx` ON `api_tokens` (CASE WHEN revoked_at IS NULL THEN expires_at WHEN expires_at IS NULL THEN revoked_at ELSE min(revoked_at, expires_at) END,`id`);--> statement-breakpoint
CREATE INDEX `audit_events_retention_idx` ON `audit_events` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `billing_checkout_claims_retention_idx` ON `billing_checkout_claims` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `billing_notices_retention_idx` ON `billing_notices` (`delivered_at`,`id`);--> statement-breakpoint
CREATE INDEX `billing_provider_events_retention_idx` ON `billing_provider_events` (coalesce(resolved_at, completed_at),`id`);--> statement-breakpoint
CREATE INDEX `email_deliveries_retention_idx` ON `email_deliveries` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_retention_idx` ON `notifications` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_expiry_idx` ON `oauth_access_token` (`expiresAt`,`id`);--> statement-breakpoint
CREATE INDEX `oauth_client_assertion_expiry_idx` ON `oauth_client_assertion` (`expiresAt`,`id`);--> statement-breakpoint
CREATE INDEX `session_expiry_idx` ON `session` (`expiresAt`,`id`);--> statement-breakpoint
CREATE INDEX `verification_expiry_idx` ON `verification` (`expiresAt`,`id`);--> statement-breakpoint
CREATE INDEX `webhook_endpoints_previous_secret_idx` ON `webhook_endpoints` (`previous_secret_expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_exports_retention_idx` ON `workspace_exports` (`completed_at`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_exports_secret_expiry_idx` ON `workspace_exports` (CASE WHEN status = 'failed' THEN completed_at ELSE expires_at END,`id`);--> statement-breakpoint
CREATE INDEX `workspace_exports_recovery_idx` ON `workspace_exports` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_retention_idx` ON `workspace_invitations` (CASE WHEN status = 'pending' THEN expiresAt ELSE terminalAt END,`id`);--> statement-breakpoint
-- Existing terminal invitations receive a full grace period from policy adoption.
UPDATE workspace_invitations SET terminalAt = unixepoch()
WHERE status <> 'pending' AND terminalAt IS NULL;
--> statement-breakpoint
CREATE TRIGGER workspace_invitation_terminal_insert AFTER INSERT ON workspace_invitations
WHEN NEW.status <> 'pending' AND NEW.terminalAt IS NULL
BEGIN
  UPDATE workspace_invitations SET terminalAt = unixepoch() WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER workspace_invitation_terminal_update AFTER UPDATE OF status ON workspace_invitations
WHEN NEW.status <> OLD.status
BEGIN
  UPDATE workspace_invitations SET terminalAt = CASE
    WHEN NEW.status = 'pending' THEN NULL
    WHEN OLD.status = 'pending' THEN unixepoch()
    ELSE coalesce(OLD.terminalAt, unixepoch()) END
  WHERE id = NEW.id;
END;
