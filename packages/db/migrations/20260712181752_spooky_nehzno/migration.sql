ALTER TABLE `gift_card_products` ADD `custom_amount_min_minor` integer;--> statement-breakpoint
ALTER TABLE `gift_card_products` ADD `custom_amount_max_minor` integer;--> statement-breakpoint
ALTER TABLE `gift_card_sales` ADD `receipt_route_id` text;--> statement-breakpoint
ALTER TABLE `gift_card_sales` ADD `receipt_token_hash` text;--> statement-breakpoint
ALTER TABLE `gift_card_sales` ADD `receipt_signing_key_id` text;--> statement-breakpoint
ALTER TABLE `gift_card_sales` ADD `receipt_expires_at` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_gift_card_sales` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL,
	`gift_card_product_id` text,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`recipient_json` text NOT NULL,
	`purchaser_json` text NOT NULL,
	`payment_id` text UNIQUE,
	`receipt_route_id` text UNIQUE,
	`receipt_token_hash` text,
	`receipt_signing_key_id` text,
	`receipt_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_gift_card_sales_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_gift_card_sales_gift_card_product_id_gift_card_products_id_fk` FOREIGN KEY (`gift_card_product_id`) REFERENCES `gift_card_products`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_gift_card_sales_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO `__new_gift_card_sales`(`id`, `shop_id`, `gift_card_product_id`, `status`, `amount_minor`, `currency`, `recipient_json`, `purchaser_json`, `payment_id`, `created_at`, `updated_at`) SELECT `id`, `shop_id`, `gift_card_product_id`, `status`, `amount_minor`, `currency`, `recipient_json`, `purchaser_json`, `payment_id`, `created_at`, `updated_at` FROM `gift_card_sales`;--> statement-breakpoint
DROP TABLE `gift_card_sales`;--> statement-breakpoint
ALTER TABLE `__new_gift_card_sales` RENAME TO `gift_card_sales`;--> statement-breakpoint
PRAGMA foreign_keys=ON;