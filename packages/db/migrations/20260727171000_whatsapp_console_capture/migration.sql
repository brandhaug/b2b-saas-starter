ALTER TABLE `booking_outbox` ADD `whatsapp_status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
UPDATE `booking_outbox` SET `whatsapp_status` = 'not_applicable' WHERE `processed_at` IS NOT NULL;
