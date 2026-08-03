-- This is intentionally forward-only: earlier Customer Directory migrations may
-- already be recorded in d1_migrations on deployed databases.
UPDATE `customer_directory_states`
SET `state_json` = json_set(
      json_set(`state_json`, '$.commands', json('[]')),
      '$.imports', json('[]')
    ),
    `revision` = `revision` + 1,
    `updated_at` = CURRENT_TIMESTAMP;--> statement-breakpoint

DROP TRIGGER IF EXISTS `customer_records_merge_target_insert_guard`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `customer_records_merge_target_update_guard`;--> statement-breakpoint

CREATE TRIGGER `customer_records_merge_target_insert_guard`
BEFORE INSERT ON `customer_records`
WHEN NEW.`merged_into` IS NOT NULL AND (
  NEW.`merged_into` = NEW.`id` OR NOT EXISTS (
    SELECT 1 FROM `customer_records` target
    WHERE target.`id` = NEW.`merged_into`
      AND target.`merchant_id` = NEW.`merchant_id`
  )
)
BEGIN SELECT RAISE(ABORT, 'customer_merge_target_invalid'); END;--> statement-breakpoint

CREATE TRIGGER `customer_records_merge_target_update_guard`
BEFORE UPDATE OF `merged_into`, `merchant_id` ON `customer_records`
WHEN NEW.`merged_into` IS NOT NULL AND (
  NEW.`merged_into` = NEW.`id` OR NOT EXISTS (
    SELECT 1 FROM `customer_records` target
    WHERE target.`id` = NEW.`merged_into`
      AND target.`merchant_id` = NEW.`merchant_id`
  )
)
BEGIN SELECT RAISE(ABORT, 'customer_merge_target_invalid'); END;--> statement-breakpoint

CREATE TRIGGER `customer_records_merge_target_delete_guard`
BEFORE DELETE ON `customer_records`
WHEN EXISTS (
  SELECT 1 FROM `customer_records` alias
  WHERE alias.`merged_into` = OLD.`id`
    AND alias.`merchant_id` = OLD.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'customer_merge_target_referenced'); END;--> statement-breakpoint

CREATE TRIGGER `customer_records_merge_target_identity_guard`
BEFORE UPDATE OF `id`, `merchant_id` ON `customer_records`
WHEN (NEW.`id` <> OLD.`id` OR NEW.`merchant_id` <> OLD.`merchant_id`) AND EXISTS (
  SELECT 1 FROM `customer_records` alias
  WHERE alias.`merged_into` = OLD.`id`
    AND alias.`merchant_id` = OLD.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'customer_merge_target_referenced'); END;--> statement-breakpoint

-- Validate pre-existing aliases after the guards exist; invalid deployed data aborts
-- the migration instead of silently carrying a cross-Merchant or self-link forward.
UPDATE `customer_records`
SET `merged_into` = `merged_into`
WHERE `merged_into` IS NOT NULL;
