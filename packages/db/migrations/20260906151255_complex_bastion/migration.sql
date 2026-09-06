ALTER TABLE `oauth_consent` ADD `grant_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER oauth_consent_grant_version
AFTER UPDATE OF scopes, resources, requestedUserInfoClaims, userId, clientId, referenceId ON oauth_consent
BEGIN
  UPDATE oauth_consent SET grant_version = OLD.grant_version + 1 WHERE id = NEW.id;
END;
