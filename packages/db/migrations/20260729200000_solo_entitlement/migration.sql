-- BeeSolo launches with one Solo entitlement and one active Owner-Provider.
-- Operator precondition: inventory and resolve every Team Merchant or incompatible
-- Provider graph before applying this migration. This migration never deletes or
-- rewrites those rows; it aborts instead.
CREATE TABLE `_beesolo_solo_contract_guard` (
  `compatible` integer NOT NULL CHECK (`compatible` = 1)
);--> statement-breakpoint
INSERT INTO `_beesolo_solo_contract_guard` (`compatible`)
SELECT 0
WHERE EXISTS (SELECT 1 FROM `merchants` WHERE `plan` <> 'solo')
   OR EXISTS (
     SELECT 1
     FROM `merchants` AS `merchant`
     LEFT JOIN `providers` AS `provider` ON `provider`.`merchant_id` = `merchant`.`id`
     GROUP BY `merchant`.`id`
     HAVING count(`provider`.`id`) <> 1
        OR max(`provider`.`is_default`) <> 1
        OR max(CASE WHEN `provider`.`status` = 'active' THEN 1 ELSE 0 END) <> 1
   );--> statement-breakpoint
DROP TABLE `_beesolo_solo_contract_guard`;--> statement-breakpoint
DROP TRIGGER `merchants_plan_insert`;--> statement-breakpoint
DROP TRIGGER `merchants_plan_update`;--> statement-breakpoint
CREATE TRIGGER `merchants_plan_insert`
BEFORE INSERT ON `merchants` WHEN NEW.`plan` <> 'solo'
BEGIN SELECT RAISE(ABORT, 'invalid merchant plan'); END;--> statement-breakpoint
CREATE TRIGGER `merchants_plan_update`
BEFORE UPDATE OF `plan` ON `merchants` WHEN NEW.`plan` <> 'solo'
BEGIN SELECT RAISE(ABORT, 'invalid merchant plan'); END;
