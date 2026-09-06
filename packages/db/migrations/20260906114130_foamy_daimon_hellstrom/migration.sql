-- Pre-production reset: old rows contain no invocation provenance. Do not
-- fabricate it from event names or the presence of a user foreign key.
DELETE FROM `audit_events`;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_type` text NOT NULL;
