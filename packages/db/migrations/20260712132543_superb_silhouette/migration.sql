CREATE TABLE `promotion_reservations` (
	`id` text PRIMARY KEY,
	`promotion_id` text NOT NULL,
	`pricing_quote_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_promotion_reservations_promotion_id_promotions_id_fk` FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_promotion_reservations_pricing_quote_id_pricing_quotes_id_fk` FOREIGN KEY (`pricing_quote_id`) REFERENCES `pricing_quotes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`value` integer NOT NULL,
	`minimum_subtotal_minor` integer DEFAULT 0 NOT NULL,
	`maximum_uses` integer,
	`starts_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_promotions_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT "promotions_valid_window" CHECK("starts_at" < "expires_at"),
	CONSTRAINT "promotions_positive_value" CHECK("value" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promotion_reservations_quote_unique` ON `promotion_reservations` (`pricing_quote_id`);--> statement-breakpoint
CREATE INDEX `promotion_reservations_usage_idx` ON `promotion_reservations` (`promotion_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `promotions_merchant_code_unique` ON `promotions` (`merchant_id`,`code`);
--> statement-breakpoint
CREATE TRIGGER `promotion_reservations_enforce_maximum_uses`
BEFORE INSERT ON `promotion_reservations`
WHEN NEW.`status` = 'active'
BEGIN
	SELECT CASE WHEN (
		SELECT `maximum_uses` FROM `promotions` WHERE `id` = NEW.`promotion_id`
	) IS NOT NULL AND (
		SELECT COUNT(*) FROM `promotion_reservations`
		WHERE `promotion_id` = NEW.`promotion_id` AND `status` IN ('active', 'committed')
	) >= (
		SELECT `maximum_uses` FROM `promotions` WHERE `id` = NEW.`promotion_id`
	) THEN RAISE(ABORT, 'promotion uses exhausted') END;
END;
