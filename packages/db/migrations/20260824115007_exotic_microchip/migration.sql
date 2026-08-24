ALTER TABLE `account` ADD `issuer` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `account` SET `issuer` = 'local:' || `providerId`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `account_issuer_accountId_uidx` ON `account` (`issuer`,`accountId`);
