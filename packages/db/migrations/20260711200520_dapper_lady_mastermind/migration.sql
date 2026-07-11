ALTER TABLE `booking_sessions` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_sessions` ADD `embedding_profile` text DEFAULT 'standalone' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_sessions` ADD `acquisition_json` text;