CREATE TABLE __booking_intent_cutover_eligible (
  intent_id text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO __booking_intent_cutover_eligible (intent_id)
SELECT ni.id
FROM notification_intents ni
JOIN appointments a
  ON a.id = ni.source_id
 AND a.status = 'scheduled'
 AND a.version = ni.source_version
JOIN scheduled_work sw
  ON sw.kind = 'appointment.reminder'
 AND sw.source_type = 'appointment'
 AND sw.source_id = ni.source_id
 AND sw.source_version = ni.source_version
 AND sw.status = 'pending'
 AND sw.run_at = ni.available_at
WHERE ni.topic = 'appointment.reminder'
  AND ni.source_type = 'appointment'
  AND ni.status = 'pending'
  AND ni.phase IS NULL
  AND julianday(ni.available_at) > julianday('now')
  AND json_extract(ni.recipient_json, '$.destination.ciphertext') IS NOT NULL
  AND json_extract(ni.recipient_json, '$.destination.fingerprint') IS NOT NULL
  AND json_extract(ni.recipient_json, '$.destination.keyVersion') IS NOT NULL
  AND json_extract(ni.recipient_json, '$.destination.maskedValue') IS NOT NULL
  AND json_extract(ni.recipient_json, '$.destination.countryCode') IS NOT NULL
  AND json_extract(ni.payload_json, '$.controlledFacts') IS NOT NULL
  AND json_extract(ni.payload_json, '$.factsFingerprint') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM submission_attempts attempt WHERE attempt.intent_id = ni.id
  );
--> statement-breakpoint
INSERT OR IGNORE INTO protected_messaging_destinations
  (id, shop_id, intent_id, ciphertext, key_version, fingerprint, masked_value,
   country_code, created_at)
SELECT
  'pmd_cutover_' || ni.id,
  ni.shop_id,
  ni.id,
  json_extract(ni.recipient_json, '$.destination.ciphertext'),
  json_extract(ni.recipient_json, '$.destination.keyVersion'),
  json_extract(ni.recipient_json, '$.destination.fingerprint'),
  json_extract(ni.recipient_json, '$.destination.maskedValue'),
  json_extract(ni.recipient_json, '$.destination.countryCode'),
  ni.created_at
FROM notification_intents ni
JOIN __booking_intent_cutover_eligible eligible ON eligible.intent_id = ni.id;
--> statement-breakpoint
INSERT OR IGNORE INTO notification_intent_controlled_facts
  (intent_id, shop_id, template_version_id, facts_json, facts_fingerprint,
   created_at, expires_at)
SELECT
  ni.id,
  ni.shop_id,
  'mtv_ro_appointment_reminder_whatsapp_v1',
  json_extract(ni.payload_json, '$.controlledFacts'),
  json_extract(ni.payload_json, '$.factsFingerprint'),
  ni.created_at,
  datetime(a.starts_at, '+30 days')
FROM notification_intents ni
JOIN __booking_intent_cutover_eligible eligible ON eligible.intent_id = ni.id
JOIN appointments a ON a.id = ni.source_id;
--> statement-breakpoint
INSERT OR IGNORE INTO delivery_routes
  (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
SELECT 'drt_cutover_' || ni.id || '_wa', ni.shop_id, ni.id, 0,
       'whatsapp', 'meta', 'planned', ni.created_at, ni.updated_at
FROM notification_intents ni
JOIN __booking_intent_cutover_eligible eligible ON eligible.intent_id = ni.id;
--> statement-breakpoint
INSERT OR IGNORE INTO delivery_routes
  (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
SELECT 'drt_cutover_' || ni.id || '_sms', ni.shop_id, ni.id, 1,
       'sms', 'smso', 'planned', ni.created_at, ni.updated_at
FROM notification_intents ni
JOIN __booking_intent_cutover_eligible eligible ON eligible.intent_id = ni.id;
--> statement-breakpoint
UPDATE notification_intents
SET purpose = 'appointment_reminder',
    phase = 'scheduled',
    locale = 'ro',
    trace_id = 'upgrade:future-reminder:' || id,
    payload_json = json_set(
      payload_json,
      '$.operationalMessagingLifecycle',
      json_object(
        'id', id,
        'shopId', shop_id,
        'topic', topic,
        'sourceType', source_type,
        'sourceId', source_id,
        'sourceVersion', source_version,
        'recipientRole', 'customer',
        'deduplicationKey', deduplication_key,
        'purpose', 'appointment_reminder',
        'locale', 'ro',
        'availableAt', available_at,
        'createdAt', created_at,
        'phase', 'scheduled',
        'supersededAfterSubmission', json('false'),
        'routes', json_array(
          json_object(
            'id', 'drt_cutover_' || id || '_wa',
            'ordinal', 0,
            'channel', 'whatsapp',
            'provider', 'meta',
            'state', 'planned',
            'attempts', json_array(),
            'submissionOutcomes', json_array(),
            'evidence', json_array()
          ),
          json_object(
            'id', 'drt_cutover_' || id || '_sms',
            'ordinal', 1,
            'channel', 'sms',
            'provider', 'smso',
            'state', 'planned',
            'attempts', json_array(),
            'submissionOutcomes', json_array(),
            'evidence', json_array()
          )
        ),
        'reconciliationCases', json_array()
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT intent_id FROM __booking_intent_cutover_eligible);
--> statement-breakpoint
UPDATE scheduled_work
SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
WHERE kind = 'appointment.reminder'
  AND status = 'pending'
  AND EXISTS (
    SELECT 1 FROM notification_intents ni
    WHERE ni.source_type = scheduled_work.source_type
      AND ni.source_id = scheduled_work.source_id
      AND ni.source_version = scheduled_work.source_version
      AND ni.available_at = scheduled_work.run_at
      AND ni.purpose = 'appointment_reminder'
      AND ni.phase = 'scheduled'
      AND ni.trace_id = 'upgrade:future-reminder:' || ni.id
  );
--> statement-breakpoint
DROP TABLE __booking_intent_cutover_eligible;
--> statement-breakpoint
PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE __new_booking_outbox (
  id text PRIMARY KEY NOT NULL,
  appointment_id text NOT NULL UNIQUE
    REFERENCES appointments(id) ON DELETE CASCADE,
  kind text NOT NULL,
  trace_id text NOT NULL,
  created_at text NOT NULL,
  claimed_at text,
  email_status text DEFAULT 'pending' NOT NULL,
  email_failure_code text,
  email_attempt_count integer DEFAULT 0 NOT NULL,
  email_next_attempt_at text,
  webhook_status text DEFAULT 'pending' NOT NULL,
  processed_at text
);
--> statement-breakpoint
INSERT INTO __new_booking_outbox
  (id, appointment_id, kind, trace_id, created_at, claimed_at, email_status,
   email_failure_code, email_attempt_count, email_next_attempt_at,
   webhook_status, processed_at)
SELECT id, appointment_id, kind, trace_id, created_at, claimed_at, email_status,
       email_failure_code, email_attempt_count, email_next_attempt_at,
       webhook_status, processed_at
FROM booking_outbox;
--> statement-breakpoint
DROP TABLE booking_outbox;
--> statement-breakpoint
ALTER TABLE __new_booking_outbox RENAME TO booking_outbox;
--> statement-breakpoint
CREATE INDEX booking_outbox_pending_idx
  ON booking_outbox(processed_at, created_at);
--> statement-breakpoint
PRAGMA foreign_keys = ON;
