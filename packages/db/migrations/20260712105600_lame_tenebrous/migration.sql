ALTER TABLE `time_slot_holds` ADD `booking_request_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `time_slot_holds_booking_request_unique` ON `time_slot_holds` (`booking_request_id`);