ALTER TABLE `workspaces` ADD `suspensionStatus` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `suspensionInternalReason` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `suspensionCustomerExplanation` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `suspensionChangedAt` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `suspensionTransitionId` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `suspensionChangedByUserId` text REFERENCES user(id) ON DELETE SET NULL;