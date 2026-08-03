DROP INDEX IF EXISTS `merchant_memberships_user_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_memberships_user_unique` ON `merchant_memberships` (`user_id`);
--> statement-breakpoint
CREATE TRIGGER `merchant_memberships_prevent_orphan`
BEFORE DELETE ON `merchant_memberships`
WHEN EXISTS (SELECT 1 FROM `merchants` WHERE `id` = OLD.`merchant_id`)
BEGIN
	SELECT RAISE(ABORT, 'a Merchant must retain its Owner membership');
END;
