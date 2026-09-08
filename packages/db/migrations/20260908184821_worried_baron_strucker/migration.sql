ALTER TABLE `session` ADD `passwordVerifiedAt` integer;--> statement-breakpoint
ALTER TABLE `session` ADD `strongAuthAt` integer;--> statement-breakpoint
ALTER TABLE `session` ADD `strongAuthMethod` text;--> statement-breakpoint
ALTER TABLE `session` ADD `strongAuthCredentialId` text;--> statement-breakpoint
ALTER TABLE `session` ADD `recoveryUntil` integer;