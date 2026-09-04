CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`issuer` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_account_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`scopes` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text,
	CONSTRAINT `fk_api_tokens_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_api_tokens_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY,
	`workspace_id` text,
	`actor_user_id` text,
	`event_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_audit_events_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_audit_events_actor_user_id_user_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_notification_preferences_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY,
	`workspace_id` text,
	`user_id` text,
	`kind` text DEFAULT 'announcement' NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_notifications_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
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
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`impersonatedBy` text,
	`activeOrganizationId` text,
	CONSTRAINT `fk_session_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY,
	`secret` text NOT NULL,
	`backupCodes` text NOT NULL,
	`userId` text NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	`failedVerificationCount` integer DEFAULT 0 NOT NULL,
	`lockedUntil` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_two_factor_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`image` text,
	`username` text UNIQUE,
	`displayUsername` text,
	`emailVerified` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'user',
	`banned` integer DEFAULT false,
	`banReason` text,
	`banExpires` integer,
	`twoFactorEnabled` integer DEFAULT false NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY,
	`endpoint_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`next_attempt_at` text,
	`response_status` integer,
	`payload` text NOT NULL,
	`request_headers` text,
	`response_body` text,
	`replayed_from` text,
	CONSTRAINT `fk_webhook_deliveries_endpoint_id_webhook_endpoints_id_fk` FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`signing_secret` text NOT NULL,
	`previous_signing_secret` text,
	`previous_secret_expires_at` text,
	`enabled` integer DEFAULT true NOT NULL,
	`events` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_webhook_endpoints_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_exports` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`requested_by_user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`object_key` text,
	`size_bytes` integer,
	`download_secret` text NOT NULL,
	`failure_reason` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`expires_at` text,
	CONSTRAINT `fk_workspace_exports_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_exports_requested_by_user_id_user_id_fk` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_invitations` (
	`id` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`inviterId` text NOT NULL,
	CONSTRAINT `fk_workspace_invitations_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_invitations_inviterId_user_id_fk` FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_workspace_members_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_members_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_sso_connections` (
	`id` text PRIMARY KEY,
	`issuer` text NOT NULL,
	`oidcConfig` text,
	`samlConfig` text,
	`userId` text NOT NULL,
	`providerId` text NOT NULL UNIQUE,
	`workspaceId` text NOT NULL,
	`domain` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`requireSso` integer DEFAULT false NOT NULL,
	`defaultWorkspaceRole` text DEFAULT 'member' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_workspace_sso_connections_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_sso_connections_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_subscriptions` (
	`workspace_id` text PRIMARY KEY,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text,
	`stripe_subscription_item_id` text,
	`seat_quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_workspace_subscriptions_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`logo` text,
	`metadata` text,
	`planId` text DEFAULT 'starter' NOT NULL,
	`onboardingDismissedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_uidx` ON `account` (`issuer`,`accountId`);--> statement-breakpoint
CREATE INDEX `api_tokens_workspace_id_idx` ON `api_tokens` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `api_tokens_created_by_user_id_idx` ON `api_tokens` (`created_by_user_id`);--> statement-breakpoint
CREATE INDEX `audit_events_workspace_created_at_idx` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_user_id_idx` ON `audit_events` (`actor_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_user_kind_idx` ON `notification_preferences` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `notifications_workspace_id_idx` ON `notifications` (`workspace_id`);--> statement-breakpoint
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
CREATE INDEX `oauth_refresh_token_authorization_code_id_idx` ON `oauth_refresh_token` (`authorizationCodeId`);--> statement-breakpoint
CREATE INDEX `passkey_user_id_idx` ON `passkey` (`userId`);--> statement-breakpoint
CREATE INDEX `passkey_credential_id_idx` ON `passkey` (`credentialID`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE INDEX `two_factor_user_id_idx` ON `two_factor` (`userId`);--> statement-breakpoint
CREATE INDEX `two_factor_secret_idx` ON `two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_endpoint_id_idx` ON `webhook_deliveries` (`endpoint_id`);--> statement-breakpoint
CREATE INDEX `webhook_endpoints_workspace_id_idx` ON `webhook_endpoints` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_exports_workspace_id_idx` ON `workspace_exports` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_exports_requested_by_user_id_idx` ON `workspace_exports` (`requested_by_user_id`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_workspace_id_idx` ON `workspace_invitations` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_email_idx` ON `workspace_invitations` (`email`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_inviter_id_idx` ON `workspace_invitations` (`inviterId`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_members_workspace_id_user_id_idx` ON `workspace_members` (`workspaceId`,`userId`);--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`userId`);--> statement-breakpoint
CREATE INDEX `workspace_sso_connections_workspace_id_idx` ON `workspace_sso_connections` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `workspace_sso_connections_domain_idx` ON `workspace_sso_connections` (`domain`);