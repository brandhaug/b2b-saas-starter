CREATE TABLE `booking_session_additional_services` (
	`booking_session_id` text NOT NULL,
	`service_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `booking_session_additional_services_pk` PRIMARY KEY(`booking_session_id`, `service_id`),
	CONSTRAINT `fk_booking_session_additional_services_booking_session_id_booking_sessions_id_fk` FOREIGN KEY (`booking_session_id`) REFERENCES `booking_sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_booking_session_additional_services_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE CASCADE,
	CONSTRAINT "booking_session_additional_services_non_negative_position" CHECK("position" >= 0)
);
--> statement-breakpoint
ALTER TABLE `booking_sessions` ADD `provider_preference` text;--> statement-breakpoint
ALTER TABLE `booking_sessions` ADD `provider_id` text REFERENCES providers(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `booking_sessions` ADD `primary_service_id` text REFERENCES services(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `booking_session_additional_services_position_unique` ON `booking_session_additional_services` (`booking_session_id`,`position`);