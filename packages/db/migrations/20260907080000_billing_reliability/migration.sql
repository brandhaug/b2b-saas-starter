CREATE TABLE `billing_checkout_claims` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`price_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`success_url` text NOT NULL,
	`cancel_url` text NOT NULL,
	`idempotency_key` text NOT NULL UNIQUE,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_session_id` text,
	`checkout_url` text,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`failure_reason` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_billing_checkout_claims_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `billing_provider_events` (
	`id` text PRIMARY KEY,
	`provider_event_id` text NOT NULL UNIQUE,
	`event_type` text NOT NULL,
	`provider_created_at` text,
	`workspace_id` text,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'processing' NOT NULL,
	`outcome` text,
	`failure_reason` text,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`received_at` text NOT NULL,
	`completed_at` text,
	`resolved_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_billing_provider_events_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `billing_synchronization` (
	`workspace_id` text PRIMARY KEY,
	`status` text DEFAULT 'pending' NOT NULL,
	`desired_seat_quantity` integer,
	`observed_seat_quantity` integer,
	`last_synced_at` text,
	`last_attempt_at` text,
	`unresolved_since` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`failure_reason` text,
	`conflict_reason` text,
	`lease_owner` text,
	`lease_fence` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_billing_synchronization_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_subscriptions_stripe_customer_idx` ON `workspace_subscriptions` (`stripe_customer_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_claims_workspace_open_idx` ON `billing_checkout_claims` (`workspace_id`) WHERE "billing_checkout_claims"."status" in ('pending', 'created');
--> statement-breakpoint
CREATE INDEX `billing_checkout_claims_workspace_status_idx` ON `billing_checkout_claims` (`workspace_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `billing_provider_events_status_idx` ON `billing_provider_events` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `billing_provider_events_workspace_idx` ON `billing_provider_events` (`workspace_id`,`received_at`);
