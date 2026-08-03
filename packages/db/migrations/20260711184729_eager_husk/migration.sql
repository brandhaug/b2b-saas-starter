CREATE TABLE `availability_offers` (
	`id` text PRIMARY KEY,
	`waiting_list_application_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`slot_json` text NOT NULL,
	`booking_session_id` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`responded_at` text,
	CONSTRAINT `fk_availability_offers_waiting_list_application_id_waiting_list_applications_id_fk` FOREIGN KEY (`waiting_list_application_id`) REFERENCES `waiting_list_applications`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_availability_offers_booking_session_id_booking_sessions_id_fk` FOREIGN KEY (`booking_session_id`) REFERENCES `booking_sessions`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `booking_parties` (
	`id` text PRIMARY KEY,
	`booking_session_id` text NOT NULL UNIQUE,
	`shop_id` text NOT NULL,
	`lifecycle` text DEFAULT 'active' NOT NULL,
	`currency` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_booking_parties_booking_session_id_booking_sessions_id_fk` FOREIGN KEY (`booking_session_id`) REFERENCES `booking_sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_booking_parties_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `booking_request_services` (
	`booking_request_id` text NOT NULL,
	`service_id` text NOT NULL,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `booking_request_services_pk` PRIMARY KEY(`booking_request_id`, `service_id`),
	CONSTRAINT `fk_booking_request_services_booking_request_id_booking_requests_id_fk` FOREIGN KEY (`booking_request_id`) REFERENCES `booking_requests`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_booking_request_services_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `booking_requests` (
	`id` text PRIMARY KEY,
	`booking_party_id` text NOT NULL,
	`position` integer NOT NULL,
	`provider_preference` text,
	`provider_id` text,
	`primary_service_id` text,
	`hold_id` text,
	`customer_account_id` text,
	`customer_details_json` text,
	`starts_at` text,
	`ends_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_booking_requests_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_booking_requests_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_booking_requests_primary_service_id_services_id_fk` FOREIGN KEY (`primary_service_id`) REFERENCES `services`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_brands_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `checkout_policies` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`disclosure` text NOT NULL,
	`effective_at` text NOT NULL,
	`retired_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_checkout_policies_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `customer_accounts` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`phone` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_customer_accounts_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `gift_card_ledger_entries` (
	`id` text PRIMARY KEY,
	`gift_card_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`booking_party_id` text,
	`idempotency_key` text NOT NULL UNIQUE,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_gift_card_ledger_entries_gift_card_id_gift_cards_id_fk` FOREIGN KEY (`gift_card_id`) REFERENCES `gift_cards`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_gift_card_ledger_entries_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `gift_card_products` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`preset_amounts_json` text NOT NULL,
	`allows_custom_amount` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_gift_card_products_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `gift_card_reservations` (
	`id` text PRIMARY KEY,
	`gift_card_id` text NOT NULL,
	`booking_party_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_gift_card_reservations_gift_card_id_gift_cards_id_fk` FOREIGN KEY (`gift_card_id`) REFERENCES `gift_cards`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_gift_card_reservations_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `gift_card_sales` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL,
	`gift_card_product_id` text,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`recipient_json` text NOT NULL,
	`purchaser_json` text NOT NULL,
	`payment_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_gift_card_sales_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_gift_card_sales_gift_card_product_id_gift_card_products_id_fk` FOREIGN KEY (`gift_card_product_id`) REFERENCES `gift_card_products`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_gift_card_sales_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `gift_cards` (
	`id` text PRIMARY KEY,
	`gift_card_sale_id` text NOT NULL UNIQUE,
	`code_hash` text NOT NULL UNIQUE,
	`status` text DEFAULT 'active' NOT NULL,
	`currency` text NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`initial_value_minor` integer NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_gift_cards_gift_card_sale_id_gift_card_sales_id_fk` FOREIGN KEY (`gift_card_sale_id`) REFERENCES `gift_card_sales`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `lifecycle_history` (
	`id` text PRIMARY KEY,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`reason_code` text,
	`facts_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `marketing_consents` (
	`id` text PRIMARY KEY,
	`merchant_id` text NOT NULL,
	`customer_account_id` text,
	`subject_json` text NOT NULL,
	`channel` text NOT NULL,
	`granted` integer NOT NULL,
	`policy_version` text NOT NULL,
	`recorded_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_marketing_consents_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_marketing_consents_customer_account_id_customer_accounts_id_fk` FOREIGN KEY (`customer_account_id`) REFERENCES `customer_accounts`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `notification_intents` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL,
	`topic` text NOT NULL,
	`recipient_json` text NOT NULL,
	`payload_json` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`deduplication_key` text NOT NULL UNIQUE,
	`status` text DEFAULT 'pending' NOT NULL,
	`available_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_notification_intents_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `payment_attempts` (
	`id` text PRIMARY KEY,
	`payment_id` text NOT NULL,
	`idempotency_key` text NOT NULL UNIQUE,
	`provider` text NOT NULL,
	`outcome` text NOT NULL,
	`provider_reference` text,
	`failure_code` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT `fk_payment_attempts_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `payment_transactions` (
	`id` text PRIMARY KEY,
	`payment_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`provider_reference` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_payment_transactions_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY,
	`booking_party_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`currency` text NOT NULL,
	`authorized_minor` integer DEFAULT 0 NOT NULL,
	`captured_minor` integer DEFAULT 0 NOT NULL,
	`refunded_minor` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_payments_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `policy_acceptances` (
	`id` text PRIMARY KEY,
	`booking_party_id` text NOT NULL,
	`checkout_policy_id` text NOT NULL,
	`disclosure_snapshot` text NOT NULL,
	`accepted_at` text NOT NULL,
	CONSTRAINT `fk_policy_acceptances_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_policy_acceptances_checkout_policy_id_checkout_policies_id_fk` FOREIGN KEY (`checkout_policy_id`) REFERENCES `checkout_policies`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `pricing_adjustments` (
	`id` text PRIMARY KEY,
	`pricing_quote_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`allocation_json` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_pricing_adjustments_pricing_quote_id_pricing_quotes_id_fk` FOREIGN KEY (`pricing_quote_id`) REFERENCES `pricing_quotes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pricing_quotes` (
	`id` text PRIMARY KEY,
	`booking_party_id` text NOT NULL,
	`version` integer NOT NULL,
	`currency` text NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`adjustment_minor` integer DEFAULT 0 NOT NULL,
	`tip_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`facts_json` text NOT NULL,
	`accepted_at` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_pricing_quotes_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `protected_access_grants` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL,
	`purpose` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`capability_hash` text NOT NULL UNIQUE,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_protected_access_grants_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `scheduled_work` (
	`id` text PRIMARY KEY,
	`shop_id` text,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`idempotency_key` text NOT NULL UNIQUE,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_failure_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_scheduled_work_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `settlement_allocations` (
	`id` text PRIMARY KEY,
	`booking_party_id` text NOT NULL,
	`tender` text NOT NULL,
	`reference_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_settlement_allocations_booking_party_id_booking_parties_id_fk` FOREIGN KEY (`booking_party_id`) REFERENCES `booking_parties`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `shop_addresses` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL UNIQUE,
	`address_json` text NOT NULL,
	`latitude` text,
	`longitude` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_shop_addresses_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `shop_providers` (
	`shop_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `shop_providers_pk` PRIMARY KEY(`shop_id`, `provider_id`),
	CONSTRAINT `fk_shop_providers_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_shop_providers_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `shop_services` (
	`shop_id` text NOT NULL,
	`service_id` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `shop_services_pk` PRIMARY KEY(`shop_id`, `service_id`),
	CONSTRAINT `fk_shop_services_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_shop_services_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `shops` (
	`id` text PRIMARY KEY,
	`brand_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`public_name` text NOT NULL,
	`timezone` text NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_shops_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_shops_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `waiting_list_applications` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`request_json` text NOT NULL,
	`customer_snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT `fk_waiting_list_applications_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `walk_in_entries` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`position` integer NOT NULL,
	`request_json` text NOT NULL,
	`customer_snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_walk_in_entries_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `availability_offers_application_id_idx` ON `availability_offers` (`waiting_list_application_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `availability_offers_one_pending_idx` ON `availability_offers` (`waiting_list_application_id`) WHERE "availability_offers"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `booking_parties_shop_id_idx` ON `booking_parties` (`shop_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `booking_request_services_position_unique` ON `booking_request_services` (`booking_request_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `booking_requests_party_position_unique` ON `booking_requests` (`booking_party_id`,`position`);--> statement-breakpoint
CREATE INDEX `booking_requests_party_id_idx` ON `booking_requests` (`booking_party_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_policies_shop_kind_version_unique` ON `checkout_policies` (`shop_id`,`kind`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_accounts_merchant_email_unique` ON `customer_accounts` (`merchant_id`,`email`);--> statement-breakpoint
CREATE INDEX `gift_card_ledger_gift_card_id_idx` ON `gift_card_ledger_entries` (`gift_card_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gift_card_reservations_party_card_unique` ON `gift_card_reservations` (`booking_party_id`,`gift_card_id`);--> statement-breakpoint
CREATE INDEX `gift_card_reservations_card_status_idx` ON `gift_card_reservations` (`gift_card_id`,`status`);--> statement-breakpoint
CREATE INDEX `lifecycle_history_aggregate_idx` ON `lifecycle_history` (`aggregate_type`,`aggregate_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `marketing_consents_subject_idx` ON `marketing_consents` (`merchant_id`,`customer_account_id`);--> statement-breakpoint
CREATE INDEX `notification_intents_status_available_idx` ON `notification_intents` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `payment_attempts_payment_id_idx` ON `payment_attempts` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payment_transactions_payment_id_idx` ON `payment_transactions` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payments_booking_party_id_idx` ON `payments` (`booking_party_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `policy_acceptances_party_policy_unique` ON `policy_acceptances` (`booking_party_id`,`checkout_policy_id`);--> statement-breakpoint
CREATE INDEX `pricing_adjustments_quote_id_idx` ON `pricing_adjustments` (`pricing_quote_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_quotes_party_version_unique` ON `pricing_quotes` (`booking_party_id`,`version`);--> statement-breakpoint
CREATE INDEX `protected_access_resource_idx` ON `protected_access_grants` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `scheduled_work_status_run_at_idx` ON `scheduled_work` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `settlement_allocations_party_id_idx` ON `settlement_allocations` (`booking_party_id`);--> statement-breakpoint
CREATE INDEX `shops_brand_id_idx` ON `shops` (`brand_id`);--> statement-breakpoint
CREATE INDEX `walk_in_entries_shop_status_position_idx` ON `walk_in_entries` (`shop_id`,`status`,`position`);--> statement-breakpoint
INSERT INTO `brands` (`id`, `merchant_id`, `name`, `created_at`, `updated_at`)
SELECT 'brd_' || `id`, `id`, `public_name`, `created_at`, `updated_at` FROM `merchants`;
--> statement-breakpoint
INSERT INTO `shops` (`id`, `brand_id`, `merchant_id`, `slug`, `public_name`, `timezone`, `currency`, `created_at`, `updated_at`)
SELECT 'shp_' || `id`, 'brd_' || `id`, `id`, `slug`, `public_name`, `timezone`, `currency`, `created_at`, `updated_at` FROM `merchants`;
--> statement-breakpoint
INSERT INTO `booking_parties` (`id`, `booking_session_id`, `shop_id`, `lifecycle`, `currency`, `locale`, `version`, `created_at`, `updated_at`)
SELECT 'bpt_' || s.`id`, s.`id`, 'shp_' || s.`merchant_id`, CASE WHEN s.`lifecycle` = 'consumed' THEN 'confirmed' ELSE 'active' END, m.`currency`, 'en', 1, s.`created_at`, s.`last_activity_at`
FROM `booking_sessions` s JOIN `merchants` m ON m.`id` = s.`merchant_id`;
--> statement-breakpoint
INSERT INTO `booking_requests` (`id`, `booking_party_id`, `position`, `provider_preference`, `provider_id`, `primary_service_id`, `hold_id`, `customer_account_id`, `customer_details_json`, `starts_at`, `ends_at`, `created_at`, `updated_at`)
SELECT 'brq_' || s.`id`, 'bpt_' || s.`id`, 0, s.`provider_preference`, s.`provider_id`, s.`primary_service_id`, h.`id`, NULL,
CASE WHEN s.`customer_name` IS NULL AND s.`customer_email` IS NULL AND s.`customer_phone` IS NULL THEN NULL ELSE json_object('name', s.`customer_name`, 'email', s.`customer_email`, 'phone', s.`customer_phone`) END,
h.`starts_at`, h.`ends_at`, s.`created_at`, s.`last_activity_at`
FROM `booking_sessions` s LEFT JOIN `time_slot_holds` h ON h.`booking_session_id` = s.`id`
WHERE s.`provider_preference` IS NOT NULL OR s.`primary_service_id` IS NOT NULL OR h.`id` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `booking_request_services` (`booking_request_id`, `service_id`, `role`, `position`, `created_at`)
SELECT 'brq_' || `id`, `primary_service_id`, 'primary', 0, `created_at` FROM `booking_sessions` WHERE `primary_service_id` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `booking_request_services` (`booking_request_id`, `service_id`, `role`, `position`, `created_at`)
SELECT 'brq_' || a.`booking_session_id`, a.`service_id`, 'additional', a.`position` + 1, s.`created_at`
FROM `booking_session_additional_services` a JOIN `booking_sessions` s ON s.`id` = a.`booking_session_id`;
--> statement-breakpoint
INSERT INTO `pricing_quotes` (`id`, `booking_party_id`, `version`, `currency`, `subtotal_minor`, `adjustment_minor`, `tip_minor`, `total_minor`, `facts_json`, `accepted_at`, `expires_at`, `created_at`)
SELECT 'pqt_' || h.`id`, 'bpt_' || h.`booking_session_id`, 1, json_extract(h.`quote`, '$.currency'), json_extract(h.`quote`, '$.totalMinor'), 0, 0, json_extract(h.`quote`, '$.totalMinor'), h.`quote`, NULL, h.`expires_at`, h.`created_at`
FROM `time_slot_holds` h;
--> statement-breakpoint
INSERT INTO `lifecycle_history` (`id`, `aggregate_type`, `aggregate_id`, `from_state`, `to_state`, `reason_code`, `facts_json`, `occurred_at`, `created_at`)
SELECT 'lch_' || `id`, 'appointment', `id`, NULL, `status`, 'legacy_backfill', '{}', `created_at`, `created_at` FROM `appointments`;
--> statement-breakpoint
INSERT INTO `notification_intents` (`id`, `shop_id`, `topic`, `recipient_json`, `payload_json`, `source_type`, `source_id`, `deduplication_key`, `status`, `available_at`, `created_at`, `updated_at`)
SELECT 'nti_' || o.`id`, 'shp_' || a.`merchant_id`, o.`kind`, COALESCE(json_extract(a.`snapshot`, '$.customerDetails'), '{}'), json_object('appointmentId', o.`appointment_id`, 'traceId', o.`trace_id`), 'appointment', o.`appointment_id`, o.`kind` || ':' || o.`appointment_id`, CASE WHEN o.`processed_at` IS NULL THEN 'pending' ELSE 'delivered' END, o.`created_at`, o.`created_at`, COALESCE(o.`processed_at`, o.`created_at`)
FROM `booking_outbox` o JOIN `appointments` a ON a.`id` = o.`appointment_id`;
