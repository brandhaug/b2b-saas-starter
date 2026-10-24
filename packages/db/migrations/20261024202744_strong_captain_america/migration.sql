ALTER TABLE `workspace_deletion_fences` ADD `purpose` text DEFAULT 'deletion' NOT NULL;
--> statement-breakpoint
-- Serialized with plugin writes: preflight owner counts are only advisory.
CREATE TRIGGER workspace_members_preserve_owner_update
BEFORE UPDATE OF role, workspaceId ON workspace_members
WHEN OLD.role = 'owner' AND (NEW.role <> 'owner' OR NEW.workspaceId <> OLD.workspaceId)
  AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspaceId = OLD.workspaceId AND role = 'owner' AND id <> OLD.id)
BEGIN SELECT RAISE(ABORT, 'workspace_sole_owner'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_members_preserve_owner_delete
BEFORE DELETE ON workspace_members
WHEN OLD.role = 'owner'
  AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspaceId)
  AND NOT EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id = OLD.workspaceId)
  AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspaceId = OLD.workspaceId AND role = 'owner' AND id <> OLD.id)
BEGIN SELECT RAISE(ABORT, 'workspace_sole_owner'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_members_deletion_insert
BEFORE INSERT ON workspace_members
WHEN EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id = NEW.workspaceId)
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_members_deletion_update
BEFORE UPDATE ON workspace_members
WHEN EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id IN (OLD.workspaceId, NEW.workspaceId))
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_deletion_billing_admission
BEFORE INSERT ON workspace_deletion_fences
WHEN NEW.purpose = 'deletion' AND (
  EXISTS (SELECT 1 FROM workspace_subscriptions WHERE workspace_id = NEW.workspace_id AND status NOT IN ('canceled', 'incomplete_expired'))
  OR EXISTS (SELECT 1 FROM billing_checkout_claims WHERE workspace_id = NEW.workspace_id AND status IN ('pending', 'created'))
  OR EXISTS (SELECT 1 FROM billing_synchronization WHERE workspace_id = NEW.workspace_id AND (status <> 'current' OR lease_owner IS NOT NULL))
  OR EXISTS (SELECT 1 FROM billing_provider_events WHERE workspace_id = NEW.workspace_id AND status <> 'completed' AND resolved_at IS NULL)
)
BEGIN SELECT RAISE(ABORT, 'workspace_billing_obligations'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_delete_billing_guard
BEFORE DELETE ON workspaces
WHEN NOT EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id = OLD.id AND purpose = 'security_recovery') AND (
  EXISTS (SELECT 1 FROM workspace_subscriptions WHERE workspace_id = OLD.id AND status NOT IN ('canceled', 'incomplete_expired'))
  OR EXISTS (SELECT 1 FROM billing_checkout_claims WHERE workspace_id = OLD.id AND status IN ('pending', 'created'))
  OR EXISTS (SELECT 1 FROM billing_synchronization WHERE workspace_id = OLD.id AND (status <> 'current' OR lease_owner IS NOT NULL))
  OR EXISTS (SELECT 1 FROM billing_provider_events WHERE workspace_id = OLD.id AND status <> 'completed' AND resolved_at IS NULL)
)
BEGIN SELECT RAISE(ABORT, 'workspace_billing_obligations'); END;
--> statement-breakpoint
-- Checkout and synchronization persist their claim/lease before provider I/O.
CREATE TRIGGER billing_checkout_deletion_insert
BEFORE INSERT ON billing_checkout_claims
WHEN EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id = NEW.workspace_id AND purpose = 'deletion')
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
CREATE TRIGGER billing_checkout_deletion_update
BEFORE UPDATE ON billing_checkout_claims
WHEN EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id IN (OLD.workspace_id, NEW.workspace_id) AND purpose = 'deletion')
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
CREATE TRIGGER billing_sync_deletion_insert
BEFORE INSERT ON billing_synchronization
WHEN EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id = NEW.workspace_id AND purpose = 'deletion')
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
CREATE TRIGGER billing_sync_deletion_update
BEFORE UPDATE ON billing_synchronization
WHEN EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id IN (OLD.workspace_id, NEW.workspace_id) AND purpose = 'deletion')
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
CREATE TRIGGER billing_subscription_deletion_insert
BEFORE INSERT ON workspace_subscriptions
WHEN EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id = NEW.workspace_id AND purpose = 'deletion')
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
CREATE TRIGGER billing_subscription_deletion_update
BEFORE UPDATE ON workspace_subscriptions
WHEN EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id IN (OLD.workspace_id, NEW.workspace_id) AND purpose = 'deletion')
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
CREATE TRIGGER billing_event_deletion_insert
BEFORE INSERT ON billing_provider_events
WHEN EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id = NEW.workspace_id AND purpose = 'deletion')
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
CREATE TRIGGER billing_event_deletion_update
BEFORE UPDATE ON billing_provider_events
WHEN NEW.workspace_id IS NOT NULL AND EXISTS (SELECT 1 FROM workspace_deletion_fences WHERE workspace_id IN (OLD.workspace_id, NEW.workspace_id) AND purpose = 'deletion')
BEGIN SELECT RAISE(ABORT, 'workspace_deleting'); END;
--> statement-breakpoint
-- A partial plugin teardown cannot silently release an ownerless workspace.
-- Frozen-database recovery deliberately reapplies historical removals instead.
CREATE TRIGGER workspace_deletion_fence_preserve_owner
BEFORE DELETE ON workspace_deletion_fences
WHEN OLD.purpose = 'deletion'
  AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id)
  AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspaceId = OLD.workspace_id AND role = 'owner')
BEGIN SELECT RAISE(ABORT, 'workspace_deletion_incomplete'); END;
