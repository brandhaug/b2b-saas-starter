ALTER TABLE `oauth_consent` ADD `ssoSessionId` text REFERENCES session(id) ON DELETE SET NULL;
