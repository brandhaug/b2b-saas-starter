ALTER TABLE `messaging_template_versions`
  ADD `enabled` integer DEFAULT 0 NOT NULL
  CONSTRAINT `messaging_template_versions_enabled_check`
  CHECK (`enabled` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `messaging_template_versions`
  ADD `provider_requested_category` text DEFAULT 'utility'
  CONSTRAINT `messaging_template_versions_requested_category_check`
  CHECK (`provider_requested_category` IS NULL OR
    `provider_requested_category` IN ('utility', 'marketing', 'authentication'));
--> statement-breakpoint
ALTER TABLE `messaging_template_versions`
  ADD `provider_observed_category` text
  CONSTRAINT `messaging_template_versions_observed_category_check`
  CHECK (`provider_observed_category` IS NULL OR
    `provider_observed_category` IN ('utility', 'marketing', 'authentication'));
--> statement-breakpoint
ALTER TABLE `messaging_template_versions`
  ADD `provider_approval_status` text DEFAULT 'pending' NOT NULL
  CONSTRAINT `messaging_template_versions_approval_status_check`
  CHECK (`provider_approval_status` IN ('pending', 'approved', 'rejected', 'disabled'));
--> statement-breakpoint
ALTER TABLE `messaging_template_versions`
  ADD `provider_approved_at` text;
--> statement-breakpoint
ALTER TABLE `messaging_template_versions`
  ADD `provider_approval_evidence_reference` text;
--> statement-breakpoint
INSERT OR IGNORE INTO `messaging_template_versions`
  (`id`, `purpose`, `locale`, `channel`, `version`, `body_fingerprint`,
   `provider_template_key`, `enabled`, `provider_requested_category`,
   `provider_approval_status`, `effective_at`, `created_at`)
VALUES
  ('mtv_ro_appointment_confirmation_whatsapp_v1', 'appointment_confirmation', 'ro', 'whatsapp', 1, 'sha256:252c1d7edf64265eccfd0f6f81d41976396d97253af1888c74eb61aeba7a9338', 'beesolo_appointment_confirmation_ro_v1', 0, 'utility', 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_ro_appointment_confirmation_sms_v1', 'appointment_confirmation', 'ro', 'sms', 1, 'sha256:998a641d32a9d74e4b30775ca9090c951705ec7a90b65e78bc97d5360631e3fa', NULL, 1, NULL, 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_ro_appointment_reminder_whatsapp_v1', 'appointment_reminder', 'ro', 'whatsapp', 1, 'sha256:d8b34a816668643b8518574525c159ba16fd7fa2412481f086e4d8701ed671a0', 'beesolo_appointment_reminder_ro_v1', 0, 'utility', 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_ro_appointment_reminder_sms_v1', 'appointment_reminder', 'ro', 'sms', 1, 'sha256:b90b61075a5b34649b2c26d29204db64bec322ae04d15dd786858eada237f3c4', NULL, 1, NULL, 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_ro_appointment_cancellation_whatsapp_v1', 'appointment_cancellation', 'ro', 'whatsapp', 1, 'sha256:2633b940e84a515922c9606b7c695ce0a87eefa29d60011dd1938c3aba860f10', 'beesolo_appointment_cancellation_ro_v1', 0, 'utility', 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_ro_appointment_cancellation_sms_v1', 'appointment_cancellation', 'ro', 'sms', 1, 'sha256:44278a7d1b3f175aeb41526c5e846233f90eddbf99379ae84e306c3709ea4320', NULL, 1, NULL, 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_ro_appointment_reschedule_whatsapp_v1', 'appointment_reschedule', 'ro', 'whatsapp', 1, 'sha256:75bb42949e955ff5129e121d6a79175ab2270ee35a4e448ce75d0106c94770e6', 'beesolo_appointment_reschedule_ro_v1', 0, 'utility', 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_ro_appointment_reschedule_sms_v1', 'appointment_reschedule', 'ro', 'sms', 1, 'sha256:e2ced6a7f80e92a6b0842075e89111edfa5973651b8aa9631910a04aeb3634c3', NULL, 1, NULL, 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_en_appointment_confirmation_whatsapp_v1', 'appointment_confirmation', 'en', 'whatsapp', 1, 'sha256:b968cdc7530c9953831af9c6cec67894c0f357cd093cb03ff5a364597e5bbd1a', 'beesolo_appointment_confirmation_en_v1', 0, 'utility', 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_en_appointment_confirmation_sms_v1', 'appointment_confirmation', 'en', 'sms', 1, 'sha256:97c4eca8d01d2172238b26a13d9802ef963ed3a13ba9b9caf652745d9e39c418', NULL, 1, NULL, 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_en_appointment_reminder_whatsapp_v1', 'appointment_reminder', 'en', 'whatsapp', 1, 'sha256:1b25cb9b1f4d4e2ce41e7546633e2ce46b9ce41e8ec0cf3674dd4c9d39629f66', 'beesolo_appointment_reminder_en_v1', 0, 'utility', 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_en_appointment_reminder_sms_v1', 'appointment_reminder', 'en', 'sms', 1, 'sha256:4cfc41cd2f6129a398ad47e23695def3f14c37d4b53e14af68a6d13cc4704a1a', NULL, 1, NULL, 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_en_appointment_cancellation_whatsapp_v1', 'appointment_cancellation', 'en', 'whatsapp', 1, 'sha256:712918e11451dd0054fa6da46d3ef272d10ccfee58c9e607742beff690a3c0e9', 'beesolo_appointment_cancellation_en_v1', 0, 'utility', 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_en_appointment_cancellation_sms_v1', 'appointment_cancellation', 'en', 'sms', 1, 'sha256:b8aa7fe41d5ddf3f053f9d904ce2e1cdb19f5a999a51bea7ac09e9d51fc5422d', NULL, 1, NULL, 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_en_appointment_reschedule_whatsapp_v1', 'appointment_reschedule', 'en', 'whatsapp', 1, 'sha256:2ddf8130d014974a516d26a958c114521eacafc85fea44926ce8f925a0e49609', 'beesolo_appointment_reschedule_en_v1', 0, 'utility', 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
  ('mtv_en_appointment_reschedule_sms_v1', 'appointment_reschedule', 'en', 'sms', 1, 'sha256:eafb2b2640eadc54c20005aedb8facf2a4efed6c314e5802ad220ca143ee07cf', NULL, 1, NULL, 'pending', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z');
