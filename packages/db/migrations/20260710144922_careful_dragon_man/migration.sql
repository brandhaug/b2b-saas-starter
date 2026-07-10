CREATE TABLE `provider_service_eligibility` (
	`merchant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`service_id` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `provider_service_eligibility_pk` PRIMARY KEY(`provider_id`, `service_id`),
	CONSTRAINT `fk_provider_service_eligibility_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_provider_service_eligibility_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_provider_service_eligibility_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`price_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_services_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT "services_name_not_blank" CHECK(length(trim("name")) > 0),
	CONSTRAINT "services_positive_price" CHECK("price_minor" > 0),
	CONSTRAINT "services_positive_duration" CHECK("duration_minutes" > 0),
	CONSTRAINT "services_currency_format" CHECK(length("currency") = 3 AND "currency" = upper("currency"))
);
--> statement-breakpoint
ALTER TABLE `merchants` ADD `plan` text DEFAULT 'solo' NOT NULL;--> statement-breakpoint
CREATE INDEX `provider_service_eligibility_merchant_id_idx` ON `provider_service_eligibility` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `provider_service_eligibility_service_id_idx` ON `provider_service_eligibility` (`service_id`);--> statement-breakpoint
CREATE INDEX `services_merchant_id_idx` ON `services` (`merchant_id`);--> statement-breakpoint
CREATE TRIGGER `provider_service_eligibility_merchant_insert`
BEFORE INSERT ON `provider_service_eligibility`
WHEN NEW.`merchant_id` <> (SELECT `merchant_id` FROM `providers` WHERE `id` = NEW.`provider_id`)
  OR NEW.`merchant_id` <> (SELECT `merchant_id` FROM `services` WHERE `id` = NEW.`service_id`)
BEGIN
  SELECT RAISE(ABORT, 'provider-service eligibility must stay within one merchant');
END;--> statement-breakpoint
CREATE TRIGGER `provider_service_eligibility_merchant_update`
BEFORE UPDATE ON `provider_service_eligibility`
WHEN NEW.`merchant_id` <> (SELECT `merchant_id` FROM `providers` WHERE `id` = NEW.`provider_id`)
  OR NEW.`merchant_id` <> (SELECT `merchant_id` FROM `services` WHERE `id` = NEW.`service_id`)
BEGIN
  SELECT RAISE(ABORT, 'provider-service eligibility must stay within one merchant');
END;--> statement-breakpoint
CREATE TRIGGER `merchants_plan_insert`
BEFORE INSERT ON `merchants` WHEN NEW.`plan` NOT IN ('solo', 'team')
BEGIN SELECT RAISE(ABORT, 'invalid merchant plan'); END;--> statement-breakpoint
CREATE TRIGGER `merchants_plan_update`
BEFORE UPDATE OF `plan` ON `merchants` WHEN NEW.`plan` NOT IN ('solo', 'team')
BEGIN SELECT RAISE(ABORT, 'invalid merchant plan'); END;--> statement-breakpoint
CREATE TRIGGER `services_status_insert`
BEFORE INSERT ON `services` WHEN NEW.`status` NOT IN ('active', 'inactive')
BEGIN SELECT RAISE(ABORT, 'invalid service status'); END;--> statement-breakpoint
CREATE TRIGGER `services_status_update`
BEFORE UPDATE OF `status` ON `services` WHEN NEW.`status` NOT IN ('active', 'inactive')
BEGIN SELECT RAISE(ABORT, 'invalid service status'); END;--> statement-breakpoint
CREATE TRIGGER `providers_status_insert`
BEFORE INSERT ON `providers` WHEN NEW.`status` NOT IN ('active', 'inactive')
BEGIN SELECT RAISE(ABORT, 'invalid provider status'); END;--> statement-breakpoint
CREATE TRIGGER `providers_status_update`
BEFORE UPDATE OF `status` ON `providers` WHEN NEW.`status` NOT IN ('active', 'inactive')
BEGIN SELECT RAISE(ABORT, 'invalid provider status'); END;
