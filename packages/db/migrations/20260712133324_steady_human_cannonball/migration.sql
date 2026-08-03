CREATE TABLE `pricing_policies` (
	`shop_id` text PRIMARY KEY,
	`tax_basis_points` integer DEFAULT 0 NOT NULL,
	`tax_label` text DEFAULT 'Tax' NOT NULL,
	`fee_minor` integer DEFAULT 0 NOT NULL,
	`fee_label` text DEFAULT 'Fee' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_pricing_policies_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pricing_quote_acceptances` (
	`pricing_quote_id` text PRIMARY KEY,
	`booking_party_id` text NOT NULL,
	`party_version` integer NOT NULL,
	`accepted_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_pricing_quote_acceptances_pricing_quote_id_pricing_quotes_id_fk` FOREIGN KEY (`pricing_quote_id`) REFERENCES `pricing_quotes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pricing_quote_acceptances_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE CASCADE
);
