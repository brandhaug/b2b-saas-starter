PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_checkout_policies` (
	`id` text PRIMARY KEY,
	`merchant_id` text,
	`brand_id` text,
	`shop_id` text,
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`disclosure` text NOT NULL,
	`effective_at` text NOT NULL,
	`retired_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_checkout_policies_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_checkout_policies_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_checkout_policies_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE,
	CONSTRAINT "checkout_policies_exact_scope" CHECK(("scope" = 'merchant' AND "merchant_id" = "scope_id" AND "brand_id" IS NULL AND "shop_id" IS NULL) OR ("scope" = 'brand' AND "merchant_id" IS NULL AND "brand_id" = "scope_id" AND "shop_id" IS NULL) OR ("scope" = 'shop' AND "merchant_id" IS NULL AND "brand_id" IS NULL AND "shop_id" = "scope_id"))
);
--> statement-breakpoint
INSERT INTO `__new_checkout_policies`(`id`, `merchant_id`, `brand_id`, `shop_id`, `scope`, `scope_id`, `kind`, `version`, `disclosure`, `effective_at`, `retired_at`, `created_at`) SELECT `id`, NULL, NULL, `shop_id`, 'shop', `shop_id`, `kind`, `version`, `disclosure`, `effective_at`, `retired_at`, `created_at` FROM `checkout_policies`;--> statement-breakpoint
DROP TABLE `checkout_policies`;--> statement-breakpoint
ALTER TABLE `__new_checkout_policies` RENAME TO `checkout_policies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `checkout_policies_shop_kind_version_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_policies_scope_kind_version_unique` ON `checkout_policies` (`scope`,`scope_id`,`kind`,`version`);
