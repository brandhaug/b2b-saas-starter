ALTER TABLE `brands` ADD `booking_config_json` text;--> statement-breakpoint
ALTER TABLE `merchants` ADD `booking_config_json` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `booking_access` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `booking_config_json` text;--> statement-breakpoint
ALTER TABLE `services` ADD `booking_config_json` text;--> statement-breakpoint
ALTER TABLE `shops` ADD `booking_config_json` text;