ALTER TABLE `booking_parties` ADD `active_request_id` text;
--> statement-breakpoint
UPDATE `booking_parties`
SET `active_request_id` = (
  SELECT `id` FROM `booking_requests`
  WHERE `booking_requests`.`booking_party_id` = `booking_parties`.`id`
  ORDER BY `position` ASC
  LIMIT 1
);
