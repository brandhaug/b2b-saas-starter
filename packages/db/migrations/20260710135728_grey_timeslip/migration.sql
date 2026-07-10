CREATE TABLE `merchant_memberships` (
	`merchant_id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_merchant_memberships_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_merchant_memberships_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "merchant_memberships_owner_only" CHECK("role" = 'owner')
);
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY,
	`public_name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`timezone` text NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`linked_user_id` text,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_providers_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_providers_linked_user_id_user_id_fk` FOREIGN KEY (`linked_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `public_booking_pages` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL UNIQUE,
	`status` text DEFAULT 'unpublished' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_public_booking_pages_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT "public_booking_pages_valid_status" CHECK("status" in ('published', 'unpublished'))
);
--> statement-breakpoint
CREATE INDEX `merchant_memberships_user_idx` ON `merchant_memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `providers_merchant_id_idx` ON `providers` (`merchant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `providers_one_default_per_merchant_idx` ON `providers` (`merchant_id`) WHERE "providers"."is_default" = 1;