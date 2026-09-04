CREATE TABLE `workspace_subscriptions` (
	`workspace_id` text PRIMARY KEY,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text,
	`stripe_subscription_item_id` text,
	`seat_quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_workspace_subscriptions_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
