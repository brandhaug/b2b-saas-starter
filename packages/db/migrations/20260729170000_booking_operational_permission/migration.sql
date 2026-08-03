ALTER TABLE `booking_requests`
  ADD `operational_messaging_permission_granted` integer;
--> statement-breakpoint
ALTER TABLE `booking_requests`
  ADD `operational_messaging_permission_policy_version` text;
--> statement-breakpoint
ALTER TABLE `booking_requests`
  ADD `operational_messaging_permission_recorded_at` text;
