ALTER TABLE capability_history RENAME TO capability_history_v1;--> statement-breakpoint
CREATE TABLE capability_history (id text PRIMARY KEY NOT NULL, merchant_id text NOT NULL, capability text NOT NULL, aggregate_id text NOT NULL, revision integer NOT NULL, kind text NOT NULL, occurred_at text NOT NULL, UNIQUE(merchant_id, capability, aggregate_id, revision));--> statement-breakpoint
INSERT INTO capability_history (id, merchant_id, capability, aggregate_id, revision, kind, occurred_at) SELECT id, merchant_id, 'legacy', aggregate_id, revision, kind, occurred_at FROM capability_history_v1;--> statement-breakpoint
DROP TABLE capability_history_v1;--> statement-breakpoint
ALTER TABLE capability_audit RENAME TO capability_audit_v1;--> statement-breakpoint
CREATE TABLE capability_audit (id text PRIMARY KEY NOT NULL, merchant_id text NOT NULL, capability text NOT NULL, aggregate_id text NOT NULL, revision integer NOT NULL, actor_kind text NOT NULL, actor_id text NOT NULL, impersonation_id text, event_kind text NOT NULL, occurred_at text NOT NULL, UNIQUE(merchant_id, capability, aggregate_id, revision));--> statement-breakpoint
INSERT INTO capability_audit (id, merchant_id, capability, aggregate_id, revision, actor_kind, actor_id, impersonation_id, event_kind, occurred_at) SELECT id, merchant_id, 'legacy', aggregate_id, revision, actor_kind, actor_id, impersonation_id, event_kind, occurred_at FROM capability_audit_v1;--> statement-breakpoint
DROP TABLE capability_audit_v1;--> statement-breakpoint
ALTER TABLE capability_outbox RENAME TO capability_outbox_v1;--> statement-breakpoint
CREATE TABLE capability_outbox (id text PRIMARY KEY NOT NULL, merchant_id text NOT NULL, capability text NOT NULL, aggregate_id text NOT NULL, revision integer NOT NULL, kind text NOT NULL, status text DEFAULT 'pending' NOT NULL CHECK(status IN ('pending','claimed','processed')), claimed_by text, claimed_at text, available_at text NOT NULL, processed_at text, created_at text NOT NULL, UNIQUE(merchant_id, capability, aggregate_id, revision, kind));--> statement-breakpoint
INSERT INTO capability_outbox (id, merchant_id, capability, aggregate_id, revision, kind, status, claimed_by, claimed_at, available_at, processed_at, created_at) SELECT id, merchant_id, 'legacy', aggregate_id, revision, kind, status, claimed_by, claimed_at, available_at, processed_at, created_at FROM capability_outbox_v1;--> statement-breakpoint
DROP TABLE capability_outbox_v1;--> statement-breakpoint
CREATE INDEX capability_outbox_recovery_idx ON capability_outbox(status, available_at, claimed_at);--> statement-breakpoint
CREATE INDEX capability_outbox_authority_idx ON capability_outbox(id, capability, claimed_by, status);--> statement-breakpoint
CREATE TABLE capability_callback_correlations (correlation_id text PRIMARY KEY NOT NULL, merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE, capability text NOT NULL, expires_at text NOT NULL, created_at text NOT NULL);--> statement-breakpoint
CREATE INDEX capability_callback_correlations_expiry_idx ON capability_callback_correlations(capability, expires_at);--> statement-breakpoint
CREATE TABLE capability_transaction_guards (id text PRIMARY KEY NOT NULL, accepted integer NOT NULL CHECK(accepted = 1));
--> statement-breakpoint
CREATE TABLE merchant_access_holds (id text PRIMARY KEY NOT NULL, merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE, reason text NOT NULL, placed_at text NOT NULL, released_at text);--> statement-breakpoint
CREATE UNIQUE INDEX merchant_access_holds_active_unique ON merchant_access_holds(merchant_id, user_id) WHERE released_at IS NULL;
