ALTER TABLE `webhook_deliveries` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD `request_headers` text;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD `response_body` text;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD `replayed_from` text;--> statement-breakpoint
ALTER TABLE `webhook_endpoints` ADD `previous_signing_secret` text;--> statement-breakpoint
ALTER TABLE `webhook_endpoints` ADD `previous_secret_expires_at` text;