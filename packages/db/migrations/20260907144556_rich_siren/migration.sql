CREATE INDEX `billing_synchronization_unresolved_status_idx` ON `billing_synchronization` (`unresolved_since`,`status`);--> statement-breakpoint
CREATE INDEX `email_deliveries_accepted_updated_idx` ON `email_deliveries` (`accepted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `email_deliveries_status_created_idx` ON `email_deliveries` (`status`,`created_at`);