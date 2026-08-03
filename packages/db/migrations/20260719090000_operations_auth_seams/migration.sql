ALTER TABLE `user` ADD `identityClass` text DEFAULT 'merchant_member' NOT NULL;
--> statement-breakpoint
UPDATE `user`
SET `identityClass` = 'customer_account'
WHERE `id` IN (
	SELECT `userId` FROM `account` WHERE `providerId` IN ('google', 'apple')
);
--> statement-breakpoint
ALTER TABLE `user` ADD `twoFactorEnabled` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `session` ADD `operatorIdleExpiresAt` integer;
--> statement-breakpoint
ALTER TABLE `session` ADD `operatorAbsoluteExpiresAt` integer;
--> statement-breakpoint
CREATE TABLE `twoFactor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backupCodes` text NOT NULL,
	`userId` text NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	`failedVerificationCount` integer DEFAULT 0 NOT NULL,
	`lockedUntil` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `two_factor_user_id_idx` ON `twoFactor` (`userId`);
