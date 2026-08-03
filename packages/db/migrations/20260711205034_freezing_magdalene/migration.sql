ALTER TABLE `booking_sessions` ADD `route_id` text;--> statement-breakpoint
UPDATE `booking_sessions` SET `route_id` = 'brt_' || lower(hex(randomblob(16))) WHERE `route_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `booking_sessions_route_id_unique` ON `booking_sessions` (`route_id`);
