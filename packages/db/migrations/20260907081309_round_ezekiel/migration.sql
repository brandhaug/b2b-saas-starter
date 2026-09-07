CREATE TABLE `billing_notices` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`notice_type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	`delivered_at` text,
	CONSTRAINT `fk_billing_notices_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_resource_selections` (
	`workspace_id` text PRIMARY KEY,
	`api_token_ids` text NOT NULL,
	`webhook_endpoint_ids` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_workspace_resource_selections_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `status` text DEFAULT 'canceled' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `stripe_price_id` text;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `subscribed_plan_id` text DEFAULT 'starter' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `current_period_start` text;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `current_period_end` text;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `cancel_at_period_end` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `trial_end` text;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `first_failed_at` text;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `grace_ends_at` text;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `last_payment_at` text;--> statement-breakpoint
ALTER TABLE `workspace_subscriptions` ADD `payment_verified` integer DEFAULT false NOT NULL;