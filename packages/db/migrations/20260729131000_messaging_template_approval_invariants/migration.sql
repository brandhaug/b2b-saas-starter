UPDATE `messaging_template_versions`
SET `enabled` = 0, `retired_at` = '2026-07-29T13:10:00.000Z'
WHERE `channel` = 'sms' AND `version` = 1;
--> statement-breakpoint
INSERT INTO `messaging_template_versions`
  (`id`, `purpose`, `locale`, `channel`, `version`, `body_fingerprint`,
   `provider_template_key`, `enabled`, `provider_requested_category`,
   `provider_approval_status`, `effective_at`, `created_at`)
VALUES
  ('mtv_ro_appointment_confirmation_sms_v2', 'appointment_confirmation', 'ro', 'sms', 2, 'sha256:8ac171f906f52b00208f763498085d1f8286954bd2dd097dc81a23c790fdb904', NULL, 1, NULL, 'pending', '2026-07-29T13:10:00.000Z', '2026-07-29T13:10:00.000Z'),
  ('mtv_ro_appointment_reminder_sms_v2', 'appointment_reminder', 'ro', 'sms', 2, 'sha256:d964cc92477f25d7316b38985de9d7aeee01ec545f10a3a5623d8dfa5968af48', NULL, 1, NULL, 'pending', '2026-07-29T13:10:00.000Z', '2026-07-29T13:10:00.000Z'),
  ('mtv_ro_appointment_cancellation_sms_v2', 'appointment_cancellation', 'ro', 'sms', 2, 'sha256:02307e9d2565a858372740eca43b2876a656c23d68f4cf6114dc36a7882daa0c', NULL, 1, NULL, 'pending', '2026-07-29T13:10:00.000Z', '2026-07-29T13:10:00.000Z'),
  ('mtv_ro_appointment_reschedule_sms_v2', 'appointment_reschedule', 'ro', 'sms', 2, 'sha256:ab00343e3ea8253d4f56f9f91886e4c9e08f0c7fe9c694cbb6ad5dcba612163a', NULL, 1, NULL, 'pending', '2026-07-29T13:10:00.000Z', '2026-07-29T13:10:00.000Z'),
  ('mtv_en_appointment_confirmation_sms_v2', 'appointment_confirmation', 'en', 'sms', 2, 'sha256:e5b130fc44c795704a34c249ee2bcf73fb8262cc87b95e2850c28ed7015a0961', NULL, 1, NULL, 'pending', '2026-07-29T13:10:00.000Z', '2026-07-29T13:10:00.000Z'),
  ('mtv_en_appointment_reminder_sms_v2', 'appointment_reminder', 'en', 'sms', 2, 'sha256:7ba1118d0a7d5d8dd14d409e6e59e6a2740a08dfcb5011b152986a5fa926fc81', NULL, 1, NULL, 'pending', '2026-07-29T13:10:00.000Z', '2026-07-29T13:10:00.000Z'),
  ('mtv_en_appointment_cancellation_sms_v2', 'appointment_cancellation', 'en', 'sms', 2, 'sha256:3aa790c23299c3c15ab1af855d3f0281847eae6b22adff79f60990e378ebeae1', NULL, 1, NULL, 'pending', '2026-07-29T13:10:00.000Z', '2026-07-29T13:10:00.000Z'),
  ('mtv_en_appointment_reschedule_sms_v2', 'appointment_reschedule', 'en', 'sms', 2, 'sha256:1ddcf05959fed546b2a3467edf8b61a1fc3875e4c8ba72f143c3ec7fdf4811af', NULL, 1, NULL, 'pending', '2026-07-29T13:10:00.000Z', '2026-07-29T13:10:00.000Z');
--> statement-breakpoint
CREATE TRIGGER `messaging_template_approved_insert_guard`
BEFORE INSERT ON `messaging_template_versions`
WHEN NEW.`channel` = 'whatsapp' AND NEW.`provider_approval_status` = 'approved'
  AND (
    NEW.`enabled` <> 1 OR
    NEW.`provider_template_key` IS NULL OR NEW.`provider_template_key` = '' OR
    NEW.`provider_requested_category` IS NULL OR
    NEW.`provider_observed_category` IS NULL OR
    NEW.`provider_approved_at` IS NULL OR
    NEW.`provider_approval_evidence_reference` IS NULL OR
    NEW.`provider_approval_evidence_reference` = ''
  )
BEGIN
  SELECT RAISE(ABORT, 'approved WhatsApp template requires complete approval evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `messaging_template_approved_update_guard`
BEFORE UPDATE ON `messaging_template_versions`
WHEN NEW.`channel` = 'whatsapp' AND NEW.`provider_approval_status` = 'approved'
  AND (
    NEW.`enabled` <> 1 OR
    NEW.`provider_template_key` IS NULL OR NEW.`provider_template_key` = '' OR
    NEW.`provider_requested_category` IS NULL OR
    NEW.`provider_observed_category` IS NULL OR
    NEW.`provider_approved_at` IS NULL OR
    NEW.`provider_approval_evidence_reference` IS NULL OR
    NEW.`provider_approval_evidence_reference` = ''
  )
BEGIN
  SELECT RAISE(ABORT, 'approved WhatsApp template requires complete approval evidence');
END;
