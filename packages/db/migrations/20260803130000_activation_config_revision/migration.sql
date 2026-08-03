CREATE TABLE `merchant_activation_config_revisions` (
  `merchant_id` text PRIMARY KEY NOT NULL REFERENCES `merchants`(`id`) ON DELETE CASCADE,
  `revision` integer DEFAULT 1 NOT NULL CHECK (`revision` > 0),
  `updated_at` text NOT NULL
);--> statement-breakpoint

CREATE TABLE `schedule_changes` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `kind` text NOT NULL CHECK (`kind` IN ('weekly_hours','date_override','blocked_time','timezone','booking_window','service_buffers','service_configuration','service_eligibility')),
  `actor_id` text NOT NULL,
  `reason` text,
  `before_json` text NOT NULL,
  `after_json` text NOT NULL,
  `occurred_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `schedule_changes_merchant_time_idx`
ON `schedule_changes` (`merchant_id`,`occurred_at`);--> statement-breakpoint

CREATE TRIGGER `schedule_rules_activation_revision_insert`
AFTER INSERT ON `schedule_rules`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` (`merchant_id`,`revision`,`updated_at`)
  VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET
    `revision`=`revision`+1, `updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `schedule_rules_activation_revision_update`
AFTER UPDATE ON `schedule_rules`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` (`merchant_id`,`revision`,`updated_at`)
  VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET
    `revision`=`revision`+1, `updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `schedule_rules_activation_revision_delete`
AFTER DELETE ON `schedule_rules`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` (`merchant_id`,`revision`,`updated_at`)
  VALUES (OLD.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET
    `revision`=`revision`+1, `updated_at`=CURRENT_TIMESTAMP;
END;
--> statement-breakpoint

CREATE TRIGGER `merchants_activation_revision_update`
AFTER UPDATE OF `public_name`,`slug` ON `merchants`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `shops_activation_revision_update`
AFTER UPDATE OF `public_name`,`slug`,`timezone` ON `shops`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `shop_addresses_activation_revision_insert`
AFTER INSERT ON `shop_addresses`
BEGIN
  INSERT INTO `merchant_activation_config_revisions`
  SELECT s.`merchant_id`,1,CURRENT_TIMESTAMP FROM `shops` s WHERE s.`id`=NEW.`shop_id`
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `shop_addresses_activation_revision_update`
AFTER UPDATE ON `shop_addresses`
BEGIN
  INSERT INTO `merchant_activation_config_revisions`
  SELECT s.`merchant_id`,1,CURRENT_TIMESTAMP FROM `shops` s WHERE s.`id`=NEW.`shop_id`
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `shop_addresses_activation_revision_delete`
AFTER DELETE ON `shop_addresses`
BEGIN
  INSERT INTO `merchant_activation_config_revisions`
  SELECT s.`merchant_id`,1,CURRENT_TIMESTAMP FROM `shops` s WHERE s.`id`=OLD.`shop_id`
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `shop_providers_activation_revision_insert`
AFTER INSERT ON `shop_providers`
BEGIN
  INSERT INTO `merchant_activation_config_revisions`
  SELECT s.`merchant_id`,1,CURRENT_TIMESTAMP FROM `shops` s WHERE s.`id`=NEW.`shop_id`
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `shop_providers_activation_revision_delete`
AFTER DELETE ON `shop_providers`
BEGIN
  INSERT INTO `merchant_activation_config_revisions`
  SELECT s.`merchant_id`,1,CURRENT_TIMESTAMP FROM `shops` s WHERE s.`id`=OLD.`shop_id`
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `shop_services_activation_revision_insert`
AFTER INSERT ON `shop_services`
BEGIN
  INSERT INTO `merchant_activation_config_revisions`
  SELECT s.`merchant_id`,1,CURRENT_TIMESTAMP FROM `shops` s WHERE s.`id`=NEW.`shop_id`
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `shop_services_activation_revision_delete`
AFTER DELETE ON `shop_services`
BEGIN
  INSERT INTO `merchant_activation_config_revisions`
  SELECT s.`merchant_id`,1,CURRENT_TIMESTAMP FROM `shops` s WHERE s.`id`=OLD.`shop_id`
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint

CREATE TRIGGER `providers_activation_revision_insert`
AFTER INSERT ON `providers`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `providers_activation_revision_update`
AFTER UPDATE ON `providers`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `providers_activation_revision_delete`
AFTER DELETE ON `providers`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (OLD.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint

CREATE TRIGGER `services_activation_revision_insert`
AFTER INSERT ON `services`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `services_activation_revision_update`
AFTER UPDATE ON `services`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `services_activation_revision_delete`
AFTER DELETE ON `services`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (OLD.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint

CREATE TRIGGER `eligibility_activation_revision_insert`
AFTER INSERT ON `provider_service_eligibility`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `eligibility_activation_revision_delete`
AFTER DELETE ON `provider_service_eligibility`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (OLD.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint

CREATE TRIGGER `schedule_exceptions_activation_revision_insert`
AFTER INSERT ON `schedule_exceptions`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `schedule_exceptions_activation_revision_update`
AFTER UPDATE ON `schedule_exceptions`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `schedule_exceptions_activation_revision_delete`
AFTER DELETE ON `schedule_exceptions`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (OLD.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint

CREATE TRIGGER `blocked_times_activation_revision_insert`
AFTER INSERT ON `blocked_times`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `blocked_times_activation_revision_update`
AFTER UPDATE ON `blocked_times`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;--> statement-breakpoint
CREATE TRIGGER `blocked_times_activation_revision_delete`
AFTER DELETE ON `blocked_times`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (OLD.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;
--> statement-breakpoint
CREATE TRIGGER `booking_policies_activation_revision_update`
AFTER UPDATE OF `booking_policies_json`,`policies_confirmed_at`
ON `merchant_activation_states`
BEGIN
  INSERT INTO `merchant_activation_config_revisions` VALUES (NEW.`merchant_id`,1,CURRENT_TIMESTAMP)
  ON CONFLICT (`merchant_id`) DO UPDATE SET `revision`=`revision`+1,`updated_at`=CURRENT_TIMESTAMP;
END;
