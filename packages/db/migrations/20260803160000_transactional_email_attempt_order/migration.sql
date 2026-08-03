ALTER TABLE `transactional_email_evidence`
  ADD COLUMN `attempt_order` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `transactional_email_evidence`
  SET `attempt_order` = `rowid`;
