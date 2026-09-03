CREATE TABLE `jwks` (
	`id` text PRIMARY KEY,
	`publicKey` text NOT NULL,
	`privateKey` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`expiresAt` integer,
	`alg` text,
	`crv` text
);
--> statement-breakpoint
CREATE TABLE `oauth_access_token` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text,
	`referenceId` text,
	`authorizationCodeId` text,
	`resources` text,
	`requestedUserInfoClaims` text,
	`refreshId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_access_token_clientId_oauth_client_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauth_client`(`clientId`),
	CONSTRAINT `fk_oauth_access_token_sessionId_session_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_access_token_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_oauth_access_token_refreshId_oauth_refresh_token_id_fk` FOREIGN KEY (`refreshId`) REFERENCES `oauth_refresh_token`(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_client` (
	`id` text PRIMARY KEY,
	`clientId` text NOT NULL UNIQUE,
	`clientSecret` text,
	`clientDiscoveryId` text,
	`disabled` integer DEFAULT false,
	`skipConsent` integer,
	`enableEndSession` integer,
	`subjectType` text,
	`scopes` text,
	`clientCredentialsScopes` text DEFAULT '[]',
	`userId` text,
	`createdAt` integer,
	`updatedAt` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`softwareId` text,
	`softwareVersion` text,
	`softwareStatement` text,
	`redirectUris` text NOT NULL,
	`postLogoutRedirectUris` text,
	`backchannelLogoutUri` text,
	`backchannelLogoutSessionRequired` integer,
	`tokenEndpointAuthMethod` text,
	`applicationType` text,
	`jwks` text,
	`jwksUri` text,
	`grantTypes` text,
	`responseTypes` text,
	`requirePKCE` integer,
	`dpopBoundAccessTokens` integer DEFAULT false,
	`referenceId` text,
	`metadata` text,
	CONSTRAINT `fk_oauth_client_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_client_assertion` (
	`id` text PRIMARY KEY,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_client_resource` (
	`id` text PRIMARY KEY,
	`clientId` text NOT NULL,
	`resourceId` text NOT NULL,
	`metadata` text,
	`createdAt` integer,
	CONSTRAINT `fk_oauth_client_resource_clientId_oauth_client_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauth_client`(`clientId`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_client_resource_resourceId_oauth_resource_identifier_fk` FOREIGN KEY (`resourceId`) REFERENCES `oauth_resource`(`identifier`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_consent` (
	`id` text PRIMARY KEY,
	`clientId` text NOT NULL,
	`userId` text,
	`referenceId` text,
	`resources` text,
	`requestedUserInfoClaims` text,
	`scopes` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_oauth_consent_clientId_oauth_client_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauth_client`(`clientId`),
	CONSTRAINT `fk_oauth_consent_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_refresh_token` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text NOT NULL,
	`referenceId` text,
	`authorizationCodeId` text,
	`resources` text,
	`requestedUserInfoClaims` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`revoked` integer,
	`rotatedAt` integer,
	`rotationReplayResponse` text,
	`rotationReplayExpiresAt` integer,
	`authTime` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_refresh_token_clientId_oauth_client_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauth_client`(`clientId`),
	CONSTRAINT `fk_oauth_refresh_token_sessionId_session_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_refresh_token_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_resource` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`accessTokenTtl` integer,
	`refreshTokenTtl` integer,
	`signingAlgorithm` text,
	`signingKeyId` text,
	`allowedScopes` text,
	`customClaims` text,
	`dpopBoundAccessTokensRequired` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`createdAt` integer,
	`updatedAt` integer,
	`policyVersion` integer DEFAULT 1,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `oauth_access_token_client_id_idx` ON `oauth_access_token` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_session_id_idx` ON `oauth_access_token` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_user_id_idx` ON `oauth_access_token` (`userId`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_authorization_code_id_idx` ON `oauth_access_token` (`authorizationCodeId`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_refresh_id_idx` ON `oauth_access_token` (`refreshId`);--> statement-breakpoint
CREATE INDEX `oauth_client_user_id_idx` ON `oauth_client` (`userId`);--> statement-breakpoint
CREATE INDEX `oauth_client_resource_client_id_idx` ON `oauth_client_resource` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_client_resource_resource_id_idx` ON `oauth_client_resource` (`resourceId`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_client_resource_client_resource_idx` ON `oauth_client_resource` (`clientId`,`resourceId`);--> statement-breakpoint
CREATE INDEX `oauth_consent_client_id_idx` ON `oauth_consent` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_consent_user_id_idx` ON `oauth_consent` (`userId`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_client_id_idx` ON `oauth_refresh_token` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_session_id_idx` ON `oauth_refresh_token` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_user_id_idx` ON `oauth_refresh_token` (`userId`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_authorization_code_id_idx` ON `oauth_refresh_token` (`authorizationCodeId`);