CREATE TABLE `passkey` (
	`id` text PRIMARY KEY,
	`name` text,
	`publicKey` text NOT NULL,
	`userId` text NOT NULL,
	`credentialID` text NOT NULL,
	`counter` integer NOT NULL,
	`deviceType` text NOT NULL,
	`backedUp` integer NOT NULL,
	`transports` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`aaguid` text,
	CONSTRAINT `fk_passkey_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `passkey_user_id_idx` ON `passkey` (`userId`);--> statement-breakpoint
CREATE INDEX `passkey_credential_id_idx` ON `passkey` (`credentialID`);