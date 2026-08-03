-- Expand only. Candidate and previous Workers can continue using every prior table.
-- The guard is deliberately first: an incompatible production graph aborts before
-- any durable schema or row change is made.
INSERT INTO `merchants`
  (`id`,`public_name`,`slug`,`status`,`timezone`,`currency`,`plan`,
   `booking_config_json`,`created_at`,`updated_at`)
SELECT candidate.`id`, candidate.`public_name`, candidate.`slug`, candidate.`status`,
       candidate.`timezone`, candidate.`currency`, candidate.`plan`,
       candidate.`booking_config_json`, candidate.`created_at`, candidate.`updated_at`
FROM `merchants` candidate
WHERE EXISTS (
  SELECT 1 FROM `merchants` m
  LEFT JOIN `providers` p ON p.`merchant_id` = m.`id`
  GROUP BY m.`id`
  HAVING m.`plan` <> 'solo'
     OR count(p.`id`) <> 1
     OR sum(CASE WHEN p.`status` = 'active' AND p.`is_default` = 1 THEN 1 ELSE 0 END) <> 1
)
OR EXISTS (
  SELECT 1 FROM `merchants` m
  LEFT JOIN `merchant_memberships` mm ON mm.`merchant_id` = m.`id`
  GROUP BY m.`id`
  HAVING count(mm.`merchant_id`) <> 1 OR max(mm.`role`) <> 'owner'
)
OR EXISTS (
  SELECT 1 FROM `providers` p
  JOIN `merchant_memberships` mm ON mm.`merchant_id` = p.`merchant_id`
  WHERE p.`linked_user_id` IS NULL OR p.`linked_user_id` <> mm.`user_id`
)
OR EXISTS (
  SELECT 1 FROM `merchants` m
  LEFT JOIN `shops` s ON s.`merchant_id` = m.`id`
  GROUP BY m.`id`
  HAVING count(s.`id`) <> 1
)
OR EXISTS (
  SELECT 1 FROM `shops` s
  JOIN `brands` b ON b.`id` = s.`brand_id`
  WHERE b.`merchant_id` <> s.`merchant_id`
)
OR EXISTS (
  SELECT 1 FROM `services` s
  JOIN `providers` p ON p.`merchant_id` = s.`merchant_id`
  LEFT JOIN `provider_service_eligibility` pse
    ON pse.`merchant_id` = s.`merchant_id`
   AND pse.`provider_id` = p.`id`
   AND pse.`service_id` = s.`id`
  WHERE s.`status` = 'active' AND pse.`service_id` IS NULL
)
OR EXISTS (
  SELECT 1
  FROM `provider_service_eligibility` pse
  JOIN `providers` p ON p.`id` = pse.`provider_id`
  JOIN `services` s ON s.`id` = pse.`service_id`
  WHERE pse.`merchant_id` <> p.`merchant_id`
     OR pse.`merchant_id` <> s.`merchant_id`
)
ORDER BY candidate.`id`
LIMIT 1;--> statement-breakpoint

CREATE UNIQUE INDEX `brands_id_merchant_unique`
ON `brands` (`id`,`merchant_id`);--> statement-breakpoint

CREATE TABLE `beesolo_migration_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `migration_name` text NOT NULL,
  `fact_kind` text NOT NULL,
  `cursor` text,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending','running','complete','failed')),
  `processed_count` integer DEFAULT 0 NOT NULL CHECK (`processed_count` >= 0),
  `source_count` integer NOT NULL CHECK (`source_count` >= 0),
  `failure_code` text,
  `started_at` text,
  `completed_at` text,
  `updated_at` text NOT NULL,
  UNIQUE(`migration_name`, `fact_kind`)
);--> statement-breakpoint
CREATE INDEX `beesolo_migration_jobs_status_idx` ON `beesolo_migration_jobs` (`status`,`updated_at`);--> statement-breakpoint

CREATE TABLE `beesolo_migration_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `migration_name` text NOT NULL,
  `phase` text NOT NULL CHECK (`phase` IN ('preflight','before','batch','after','repair')),
  `fact_kind` text NOT NULL,
  `row_count` integer NOT NULL CHECK (`row_count` >= 0),
  `invariant_version` text NOT NULL,
  `details_json` text NOT NULL,
  `recorded_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `beesolo_migration_evidence_lookup_idx` ON `beesolo_migration_evidence` (`migration_name`,`phase`,`fact_kind`);--> statement-breakpoint
INSERT INTO `beesolo_migration_evidence`
  (`id`,`migration_name`,`phase`,`fact_kind`,`row_count`,`invariant_version`,`details_json`,`recorded_at`)
SELECT '20260802120000_beesolo_expand:preflight', '20260802120000_beesolo_expand',
       'preflight', 'appointment_foundations', count(*), 'beesolo-expand-v2',
       json_object('soloMerchantCount', count(*)), CURRENT_TIMESTAMP
FROM `merchants`;--> statement-breakpoint
INSERT INTO `beesolo_migration_evidence`
  (`id`,`migration_name`,`phase`,`fact_kind`,`row_count`,`invariant_version`,`details_json`,`recorded_at`)
SELECT '20260802120000_beesolo_expand:before:appointment_foundations',
       '20260802120000_beesolo_expand', 'before', 'appointment_foundations',
       count(*), 'beesolo-expand-v2', json_object('source', 'appointments'),
       CURRENT_TIMESTAMP
FROM `appointments`;--> statement-breakpoint

CREATE TABLE `merchant_subscriptions` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL UNIQUE REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `plan` text DEFAULT 'solo' NOT NULL CHECK (`plan` = 'solo'),
  `status` text NOT NULL CHECK (`status` IN ('trialing','active','grace','restricted','cancelled')),
  `provider_customer_ref` text,
  `provider_subscription_ref` text UNIQUE,
  `trial_ends_at` text,
  `current_period_ends_at` text,
  `grace_ends_at` text,
  `cancel_at_period_end` integer DEFAULT 0 NOT NULL CHECK (`cancel_at_period_end` IN (0,1)),
  `revision` integer DEFAULT 1 NOT NULL CHECK (`revision` > 0),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);--> statement-breakpoint

CREATE TABLE `schedule_exceptions` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE CASCADE,
  `local_date` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('closed','replacement_hours')),
  `intervals_json` text NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL CHECK (`revision` > 0),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  UNIQUE(`merchant_id`,`local_date`)
);--> statement-breakpoint
CREATE TABLE `blocked_times` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE CASCADE,
  `starts_at` text NOT NULL,
  `ends_at` text NOT NULL,
  `reason` text,
  `revision` integer DEFAULT 1 NOT NULL CHECK (`revision` > 0),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`starts_at` < `ends_at`)
);--> statement-breakpoint
CREATE INDEX `blocked_times_merchant_interval_idx` ON `blocked_times` (`merchant_id`,`starts_at`,`ends_at`);--> statement-breakpoint

CREATE TABLE `customer_records` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `display_name` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active','quarantined','erased')),
  `preferred_locale` text DEFAULT 'en' NOT NULL CHECK (`preferred_locale` IN ('en','ro')),
  `merchant_note` text,
  `revision` integer DEFAULT 1 NOT NULL CHECK (`revision` > 0),
  `last_activity_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  UNIQUE(`id`,`merchant_id`)
);--> statement-breakpoint
CREATE INDEX `customer_records_merchant_activity_idx` ON `customer_records` (`merchant_id`,`last_activity_at`);--> statement-breakpoint
CREATE TABLE `customer_contacts` (
  `id` text PRIMARY KEY NOT NULL,
  `customer_record_id` text NOT NULL REFERENCES `customer_records`(`id`) ON DELETE CASCADE,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `kind` text NOT NULL CHECK (`kind` IN ('email','phone')),
  `normalized_value` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active','disputed','superseded','erased')),
  `is_preferred` integer DEFAULT 0 NOT NULL CHECK (`is_preferred` IN (0,1)),
  `verified_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`customer_record_id`,`merchant_id`)
    REFERENCES `customer_records`(`id`,`merchant_id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_contacts_preferred_kind_unique` ON `customer_contacts` (`customer_record_id`,`kind`) WHERE `is_preferred` = 1 AND `status` = 'active';--> statement-breakpoint

CREATE UNIQUE INDEX `appointments_id_merchant_unique`
ON `appointments` (`id`,`merchant_id`);--> statement-breakpoint
CREATE TABLE `appointment_foundations` (
  `appointment_id` text PRIMARY KEY NOT NULL REFERENCES `appointments`(`id`) ON DELETE CASCADE,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `customer_record_id` text REFERENCES `customer_records`(`id`) ON DELETE SET NULL,
  `origin` text DEFAULT 'public_booking' NOT NULL CHECK (`origin` IN ('public_booking','merchant_created','walk_in','waiting_list')),
  `customer_note` text,
  `series_id` text,
  `series_position` integer,
  `foundation_version` integer DEFAULT 1 NOT NULL CHECK (`foundation_version` = 1),
  `created_at` text NOT NULL,
  UNIQUE(`series_id`,`series_position`),
  FOREIGN KEY (`appointment_id`,`merchant_id`)
    REFERENCES `appointments`(`id`,`merchant_id`) ON DELETE CASCADE,
  FOREIGN KEY (`customer_record_id`,`merchant_id`)
    REFERENCES `customer_records`(`id`,`merchant_id`) ON DELETE RESTRICT,
  FOREIGN KEY (`series_id`,`merchant_id`)
    REFERENCES `appointment_series`(`id`,`merchant_id`) ON DELETE RESTRICT,
  CHECK ((`series_id` IS NULL AND `series_position` IS NULL)
      OR (`series_id` IS NOT NULL AND `series_position` >= 0))
);--> statement-breakpoint
CREATE INDEX `appointment_foundations_merchant_origin_idx` ON `appointment_foundations` (`merchant_id`,`origin`);--> statement-breakpoint
CREATE TRIGGER `appointment_foundations_customer_unlink_before_delete`
BEFORE DELETE ON `customer_records`
BEGIN
  UPDATE `appointment_foundations`
  SET `customer_record_id` = NULL
  WHERE `customer_record_id` = OLD.`id`
    AND `merchant_id` = OLD.`merchant_id`;
END;--> statement-breakpoint
CREATE TABLE `appointment_series` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `idempotency_key` text NOT NULL,
  `service_snapshot_json` text NOT NULL,
  `customer_snapshot_json` text NOT NULL,
  `weekday` integer NOT NULL CHECK (`weekday` BETWEEN 0 AND 6),
  `local_start_time` text NOT NULL CHECK (
    `local_start_time` GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(`local_start_time`, 1, 2) BETWEEN '00' AND '23'
  ),
  `interval_weeks` integer NOT NULL CHECK (`interval_weeks` BETWEEN 1 AND 8),
  `occurrence_count` integer NOT NULL CHECK (`occurrence_count` BETWEEN 2 AND 52),
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active','cancelled_remaining')),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  UNIQUE(`merchant_id`,`idempotency_key`),
  UNIQUE(`id`,`merchant_id`)
);--> statement-breakpoint
CREATE TRIGGER `appointment_foundations_series_membership_guard`
BEFORE INSERT ON `appointment_foundations`
WHEN NEW.`series_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `appointment_series` s
  WHERE s.`id` = NEW.`series_id`
    AND s.`merchant_id` = NEW.`merchant_id`
    AND NEW.`series_position` < s.`occurrence_count`
)
BEGIN SELECT RAISE(ABORT, 'invalid Appointment Series membership'); END;--> statement-breakpoint
CREATE TRIGGER `appointment_foundations_series_membership_update_guard`
BEFORE UPDATE OF `series_id`,`series_position`,`merchant_id` ON `appointment_foundations`
WHEN NEW.`series_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `appointment_series` s
  WHERE s.`id` = NEW.`series_id`
    AND s.`merchant_id` = NEW.`merchant_id`
    AND NEW.`series_position` < s.`occurrence_count`
)
BEGIN SELECT RAISE(ABORT, 'invalid Appointment Series membership'); END;--> statement-breakpoint
CREATE TRIGGER `appointment_foundations_series_immutable_guard`
BEFORE UPDATE OF `series_id`,`series_position` ON `appointment_foundations`
BEGIN SELECT RAISE(ABORT, 'Appointment Series membership is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `appointment_series_shape_update_guard`
BEFORE UPDATE OF `id`,`merchant_id`,`idempotency_key`,`service_snapshot_json`,
  `customer_snapshot_json`,`weekday`,`local_start_time`,`interval_weeks`,
  `occurrence_count`,`created_at` ON `appointment_series`
BEGIN SELECT RAISE(ABORT, 'Appointment Series shape is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `appointment_series_delete_guard`
BEFORE DELETE ON `appointment_series`
BEGIN SELECT RAISE(ABORT, 'Appointment Series is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `appointment_foundations_previous_worker_insert`
AFTER INSERT ON `appointments`
BEGIN
  INSERT INTO `appointment_foundations`
    (`appointment_id`,`merchant_id`,`origin`,`foundation_version`,`created_at`)
  VALUES (
    NEW.`id`, NEW.`merchant_id`,
    CASE WHEN NEW.`booking_session_id` IS NULL
      THEN 'merchant_created' ELSE 'public_booking' END,
    1, NEW.`created_at`
  );
  UPDATE `beesolo_migration_jobs`
  SET `status` = CASE
        WHEN (SELECT count(*) FROM `appointment_foundations`) =
             (SELECT count(*) FROM `appointments`)
        THEN 'complete' ELSE 'running' END,
      `processed_count` = (SELECT count(*) FROM `appointment_foundations`),
      `source_count` = (SELECT count(*) FROM `appointments`),
      `completed_at` = CASE
        WHEN (SELECT count(*) FROM `appointment_foundations`) =
             (SELECT count(*) FROM `appointments`)
        THEN NEW.`created_at` ELSE NULL END,
      `updated_at` = NEW.`created_at`
  WHERE `migration_name` = '20260802120000_beesolo_expand'
    AND `fact_kind` = 'appointment_foundations';
  INSERT OR REPLACE INTO `beesolo_migration_evidence`
    (`id`,`migration_name`,`phase`,`fact_kind`,`row_count`,`invariant_version`,`details_json`,`recorded_at`)
  VALUES (
    '20260802120000_beesolo_expand:old-worker:' || NEW.`id`,
    '20260802120000_beesolo_expand', 'repair', 'appointment_foundations',
    (SELECT count(*) FROM `appointment_foundations`), 'beesolo-expand-v2',
    json_object('appointmentId', NEW.`id`, 'source', 'previous-worker-trigger'),
    NEW.`created_at`
  );
END;--> statement-breakpoint

CREATE TABLE `external_collections` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `appointment_id` text NOT NULL REFERENCES `appointments`(`id`) ON DELETE RESTRICT,
  `idempotency_key` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('collection','return')),
  `method` text NOT NULL CHECK (`method` IN ('cash','card_terminal','bank_transfer','other')),
  `amount_minor` integer NOT NULL CHECK (`amount_minor` > 0),
  `currency` text NOT NULL CHECK (length(`currency`) = 3 AND `currency` = upper(`currency`)),
  `actor_id` text NOT NULL,
  `note_or_reference` text,
  `offsets_entry_id` text,
  `correction_reason` text,
  `recorded_at` text NOT NULL,
  `created_at` text NOT NULL,
  UNIQUE(`merchant_id`,`idempotency_key`),
  UNIQUE(`id`,`merchant_id`,`appointment_id`),
  FOREIGN KEY (`appointment_id`,`merchant_id`)
    REFERENCES `appointments`(`id`,`merchant_id`) ON DELETE RESTRICT,
  FOREIGN KEY (`offsets_entry_id`,`merchant_id`,`appointment_id`)
    REFERENCES `external_collections`(`id`,`merchant_id`,`appointment_id`) ON DELETE RESTRICT,
  CHECK ((`offsets_entry_id` IS NULL AND `correction_reason` IS NULL)
      OR (`offsets_entry_id` IS NOT NULL AND `correction_reason` IS NOT NULL
          AND length(trim(`correction_reason`)) > 0)),
  CHECK (`offsets_entry_id` IS NULL OR `offsets_entry_id` <> `id`)
);--> statement-breakpoint
CREATE INDEX `external_collections_appointment_idx` ON `external_collections` (`appointment_id`,`recorded_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_collections_offset_once_unique`
ON `external_collections` (`offsets_entry_id`) WHERE `offsets_entry_id` IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER `external_collections_snapshot_currency_guard`
BEFORE INSERT ON `external_collections`
WHEN NOT EXISTS (
  SELECT 1 FROM `appointments` a
  WHERE a.`id` = NEW.`appointment_id`
    AND a.`merchant_id` = NEW.`merchant_id`
    AND json_valid(a.`snapshot`)
    AND json_type(a.`snapshot`, '$.currency') = 'text'
    AND NEW.`currency` = json_extract(a.`snapshot`, '$.currency')
)
BEGIN SELECT RAISE(ABORT, 'External Collection currency must match the Appointment Price Snapshot'); END;--> statement-breakpoint
CREATE TRIGGER `external_collections_net_bounds_guard`
BEFORE INSERT ON `external_collections`
WHEN NOT EXISTS (
  SELECT 1 FROM `appointments` a
  WHERE a.`id` = NEW.`appointment_id`
    AND a.`merchant_id` = NEW.`merchant_id`
    AND json_valid(a.`snapshot`)
    AND json_type(a.`snapshot`, '$.totalMinor') IN ('integer','real')
    AND (
      COALESCE((
        SELECT sum(CASE e.`kind`
          WHEN 'collection' THEN e.`amount_minor` ELSE -e.`amount_minor` END)
        FROM `external_collections` e
        WHERE e.`appointment_id` = NEW.`appointment_id`
          AND e.`merchant_id` = NEW.`merchant_id`
      ), 0)
      + CASE NEW.`kind` WHEN 'collection' THEN NEW.`amount_minor` ELSE -NEW.`amount_minor` END
    ) BETWEEN 0 AND CAST(json_extract(a.`snapshot`, '$.totalMinor') AS integer)
)
BEGIN SELECT RAISE(ABORT, 'External Collection net must remain within the Appointment Price Snapshot total'); END;--> statement-breakpoint
CREATE TRIGGER `external_collections_exact_offset_guard`
BEFORE INSERT ON `external_collections`
WHEN NEW.`offsets_entry_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `external_collections` original
  WHERE original.`id` = NEW.`offsets_entry_id`
    AND original.`merchant_id` = NEW.`merchant_id`
    AND original.`appointment_id` = NEW.`appointment_id`
    AND original.`kind` <> NEW.`kind`
    AND original.`amount_minor` = NEW.`amount_minor`
    AND original.`currency` = NEW.`currency`
)
BEGIN SELECT RAISE(ABORT, 'External Collection correction must exactly offset its referenced entry'); END;--> statement-breakpoint
CREATE TRIGGER `appointments_snapshot_immutable_guard`
BEFORE UPDATE OF `snapshot` ON `appointments`
WHEN OLD.`snapshot` IS NOT NULL AND NEW.`snapshot` IS NOT OLD.`snapshot`
BEGIN SELECT RAISE(ABORT, 'accepted Appointment snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `external_collections_append_only_update_guard`
BEFORE UPDATE ON `external_collections`
BEGIN SELECT RAISE(ABORT, 'External Collections are append-only'); END;--> statement-breakpoint
CREATE TRIGGER `external_collections_append_only_delete_guard`
BEFORE DELETE ON `external_collections`
BEGIN SELECT RAISE(ABORT, 'External Collections are append-only'); END;--> statement-breakpoint

CREATE TABLE `privacy_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `request_type` text NOT NULL CHECK (`request_type` IN ('access','correction','erasure')),
  `status` text NOT NULL CHECK (`status` IN ('submitted','awaiting_verification','queued_for_review','awaiting_additional_evidence','approved','executing','completed','rejected','withdrawn','expired')),
  `destination_fingerprint` text NOT NULL,
  `locale` text NOT NULL CHECK (`locale` IN ('en','ro')),
  `revision` integer DEFAULT 1 NOT NULL CHECK (`revision` > 0),
  `received_at` text NOT NULL,
  `verification_expires_at` text NOT NULL,
  `governing_deadline_at` text NOT NULL,
  `terminal_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `privacy_requests_queue_idx` ON `privacy_requests` (`status`,`governing_deadline_at`);--> statement-breakpoint
CREATE TABLE `privacy_request_preflights` (
  `id` text PRIMARY KEY NOT NULL,
  `privacy_request_id` text NOT NULL REFERENCES `privacy_requests`(`id`) ON DELETE RESTRICT,
  `request_revision` integer NOT NULL,
  `source_revision` text NOT NULL,
  `policy_version` text NOT NULL,
  `manifest_json` text NOT NULL,
  `approved_at` text,
  `invalidated_at` text,
  `created_at` text NOT NULL,
  UNIQUE(`privacy_request_id`,`request_revision`)
);--> statement-breakpoint
CREATE TABLE `report_exports` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL REFERENCES `merchants`(`id`) ON DELETE RESTRICT,
  `report_kind` text NOT NULL,
  `filters_json` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('pending','ready','failed','expired')),
  `artifact_ref` text,
  `generated_at` text,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `report_exports_expiry_idx` ON `report_exports` (`status`,`expires_at`);
--> statement-breakpoint
CREATE TRIGGER `beesolo_providers_one_insert_guard`
BEFORE INSERT ON `providers`
WHEN EXISTS (SELECT 1 FROM `providers` WHERE `merchant_id` = NEW.`merchant_id`)
  OR NEW.`status` <> 'active' OR NEW.`is_default` <> 1
  OR NEW.`linked_user_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `merchant_memberships` mm
    WHERE mm.`merchant_id` = NEW.`merchant_id`
      AND mm.`user_id` = NEW.`linked_user_id`
      AND mm.`role` = 'owner'
  )
BEGIN SELECT RAISE(ABORT, 'beesolo requires one active default Owner-Provider'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_providers_owner_eligibility`
AFTER INSERT ON `providers`
BEGIN
  INSERT OR IGNORE INTO `provider_service_eligibility`
    (`merchant_id`,`provider_id`,`service_id`,`created_at`)
  SELECT NEW.`merchant_id`, NEW.`id`, s.`id`, NEW.`created_at`
  FROM `services` s
  WHERE s.`merchant_id` = NEW.`merchant_id` AND s.`status` = 'active';
END;--> statement-breakpoint
CREATE TRIGGER `beesolo_providers_shape_update_guard`
BEFORE UPDATE OF `merchant_id`,`linked_user_id`,`status`,`is_default` ON `providers`
WHEN NEW.`merchant_id` <> OLD.`merchant_id`
  OR NEW.`status` <> 'active'
  OR NEW.`is_default` <> 1
  OR NEW.`linked_user_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `merchant_memberships` mm
    WHERE mm.`merchant_id` = NEW.`merchant_id`
      AND mm.`user_id` = NEW.`linked_user_id`
      AND mm.`role` = 'owner'
  )
BEGIN SELECT RAISE(ABORT, 'beesolo Owner-Provider shape is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_providers_delete_guard`
BEFORE DELETE ON `providers`
WHEN EXISTS (SELECT 1 FROM `merchants` WHERE `id` = OLD.`merchant_id`)
BEGIN SELECT RAISE(ABORT, 'beesolo Merchant requires its Owner-Provider'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_memberships_shape_update_guard`
BEFORE UPDATE OF `merchant_id`,`user_id`,`role` ON `merchant_memberships`
WHEN NEW.`merchant_id` <> OLD.`merchant_id`
  OR NEW.`role` <> 'owner'
  OR NOT EXISTS (
    SELECT 1 FROM `providers` p
    WHERE p.`merchant_id` = NEW.`merchant_id`
      AND p.`linked_user_id` = NEW.`user_id`
  )
BEGIN SELECT RAISE(ABORT, 'beesolo Owner membership shape is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_shops_one_insert_guard`
BEFORE INSERT ON `shops`
WHEN EXISTS (SELECT 1 FROM `shops` WHERE `merchant_id` = NEW.`merchant_id`)
  OR NOT EXISTS (
    SELECT 1 FROM `brands` b
    WHERE b.`id` = NEW.`brand_id` AND b.`merchant_id` = NEW.`merchant_id`
  )
BEGIN SELECT RAISE(ABORT, 'beesolo requires exactly one Shop'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_shops_merchant_update_guard`
BEFORE UPDATE OF `merchant_id`,`brand_id` ON `shops`
WHEN NEW.`merchant_id` <> OLD.`merchant_id`
  OR NOT EXISTS (
    SELECT 1 FROM `brands` b
    WHERE b.`id` = NEW.`brand_id` AND b.`merchant_id` = NEW.`merchant_id`
  )
BEGIN SELECT RAISE(ABORT, 'beesolo Shop ownership is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_brands_merchant_update_guard`
BEFORE UPDATE OF `merchant_id` ON `brands`
WHEN NEW.`merchant_id` <> OLD.`merchant_id`
  AND EXISTS (SELECT 1 FROM `shops` s WHERE s.`brand_id` = OLD.`id`)
BEGIN SELECT RAISE(ABORT, 'beesolo Shop ownership is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_shops_delete_guard`
BEFORE DELETE ON `shops`
WHEN EXISTS (SELECT 1 FROM `merchants` WHERE `id` = OLD.`merchant_id`)
BEGIN SELECT RAISE(ABORT, 'beesolo Merchant requires its Shop'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_services_owner_eligibility`
AFTER INSERT ON `services`
BEGIN
  INSERT OR IGNORE INTO `provider_service_eligibility` (`merchant_id`,`provider_id`,`service_id`,`created_at`)
  SELECT NEW.`merchant_id`, p.`id`, NEW.`id`, NEW.`created_at`
  FROM `providers` p WHERE p.`merchant_id` = NEW.`merchant_id`;
END;--> statement-breakpoint
CREATE TRIGGER `beesolo_services_merchant_update_guard`
BEFORE UPDATE OF `merchant_id` ON `services`
WHEN NEW.`merchant_id` <> OLD.`merchant_id`
BEGIN SELECT RAISE(ABORT, 'beesolo Service ownership is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_services_owner_eligibility_on_activation`
AFTER UPDATE OF `status` ON `services`
WHEN NEW.`status` = 'active'
BEGIN
  INSERT OR IGNORE INTO `provider_service_eligibility` (`merchant_id`,`provider_id`,`service_id`,`created_at`)
  SELECT NEW.`merchant_id`, p.`id`, NEW.`id`, NEW.`updated_at`
  FROM `providers` p WHERE p.`merchant_id` = NEW.`merchant_id`;
END;--> statement-breakpoint
CREATE TRIGGER `beesolo_owner_eligibility_delete_guard`
BEFORE DELETE ON `provider_service_eligibility`
WHEN EXISTS (
  SELECT 1 FROM `services` s
  JOIN `providers` p ON p.`id` = OLD.`provider_id`
  WHERE s.`id` = OLD.`service_id`
    AND s.`merchant_id` = OLD.`merchant_id`
    AND p.`merchant_id` = OLD.`merchant_id`
    AND s.`status` = 'active'
)
BEGIN SELECT RAISE(ABORT, 'beesolo Owner-Provider remains eligible for every active Service'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_owner_eligibility_insert_guard`
BEFORE INSERT ON `provider_service_eligibility`
WHEN NOT EXISTS (
  SELECT 1 FROM `providers` p
  JOIN `services` s ON s.`id` = NEW.`service_id`
  WHERE p.`id` = NEW.`provider_id`
    AND p.`merchant_id` = NEW.`merchant_id`
    AND s.`merchant_id` = NEW.`merchant_id`
)
BEGIN SELECT RAISE(ABORT, 'beesolo Service eligibility must remain Merchant-scoped'); END;--> statement-breakpoint
CREATE TRIGGER `beesolo_owner_eligibility_update_guard`
BEFORE UPDATE OF `merchant_id`,`provider_id`,`service_id` ON `provider_service_eligibility`
BEGIN SELECT RAISE(ABORT, 'beesolo Service eligibility ownership is immutable'); END;
