-- Existing deployments may have accepted overlapping active destinations before the
-- uniqueness invariant was installed. Preserve both records, but quarantine every
-- deterministic loser as disputed before adding the invariant.
UPDATE `customer_contacts` AS candidate
SET `status` = 'disputed', `is_preferred` = 0, `updated_at` = CURRENT_TIMESTAMP
WHERE candidate.`status` = 'active'
  AND EXISTS (
    SELECT 1
    FROM `customer_contacts` winner
    WHERE winner.`merchant_id` = candidate.`merchant_id`
      AND winner.`kind` = candidate.`kind`
      AND winner.`normalized_value` = candidate.`normalized_value`
      AND winner.`status` = 'active'
      AND winner.`id` < candidate.`id`
  );--> statement-breakpoint

DROP INDEX IF EXISTS `customer_contacts_active_value_lookup`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `customer_contacts_active_value_unique`
ON `customer_contacts` (`merchant_id`,`kind`,`normalized_value`)
WHERE `status` = 'active';--> statement-breakpoint

-- Early directory adapters embedded normalized destinations in contact primary keys.
-- Nothing references this surrogate key, so rotate it to an opaque value in place.
UPDATE `customer_contacts`
SET `id` = 'cuc_' || lower(hex(randomblob(16)));--> statement-breakpoint

-- Early idempotency results and fingerprints contained full command payloads. They
-- cannot be safely upgraded, so discard replay metadata. Legacy import metadata also
-- retained raw external references and must be retired; new rows use keyed digests.
UPDATE `customer_directory_states`
SET `state_json` = json_set(
      json_set(`state_json`, '$.commands', json('[]')),
      '$.imports', json('[]')
    ),
    `revision` = `revision` + 1,
    `updated_at` = CURRENT_TIMESTAMP;--> statement-breakpoint
