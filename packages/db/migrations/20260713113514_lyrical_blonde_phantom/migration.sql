CREATE UNIQUE INDEX IF NOT EXISTS `cancellation_commands_idempotency_unique` ON `cancellation_commands` (`merchant_id`,`idempotency_key`);
