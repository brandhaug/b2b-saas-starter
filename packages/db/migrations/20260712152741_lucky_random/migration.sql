ALTER TABLE `confirmation_access` ADD `booking_party_id` text;--> statement-breakpoint
ALTER TABLE `confirmation_access` ADD `purpose` text DEFAULT 'appointment_confirmation' NOT NULL;