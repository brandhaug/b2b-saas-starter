ALTER TABLE `appointments` ADD `updated_at` text;--> statement-breakpoint
UPDATE `appointments` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;
