UPDATE `messaging_template_versions`
SET `body_fingerprint` = CASE `id`
  WHEN 'mtv_ro_appointment_confirmation_sms_v1' THEN 'sha256:20b411bcd5dcaf6d3a5554e5e62b8987b0b8c7a27ffe1bac339f7811ea1f2c9a'
  WHEN 'mtv_ro_appointment_reminder_sms_v1' THEN 'sha256:518eeeb946bd838e2b62145bb4a08eedae73191f05e7190612ef250e9cd3e113'
  WHEN 'mtv_ro_appointment_cancellation_sms_v1' THEN 'sha256:d9414fd3f0bb2aba6d8911db10723da51bbcf26875f09be5cbfacad32d418e3a'
  WHEN 'mtv_ro_appointment_reschedule_sms_v1' THEN 'sha256:2d6f8ff2f42d82d8f385c7e892660178b825a11691f088c367ea1a80e71fb119'
  WHEN 'mtv_en_appointment_confirmation_sms_v1' THEN 'sha256:5b032484d3264322a1440366deb6c4ea2bf50241dc5aca27d9d228b12240ef02'
  WHEN 'mtv_en_appointment_reminder_sms_v1' THEN 'sha256:ee6401f3fd17f90887a1c64e036bdbe7d04b80dc12db969e452725b0ff65c7aa'
  WHEN 'mtv_en_appointment_cancellation_sms_v1' THEN 'sha256:fb3710df8244cf5d121e7cd5d7d19ac58da60a95f96ab8d1ac3125eeaa8dd655'
  WHEN 'mtv_en_appointment_reschedule_sms_v1' THEN 'sha256:74064bf66902b14cb19b3de09c3ae08f508ebcb0bb014ac29ac7a7785eef0f99'
  ELSE `body_fingerprint`
END
WHERE `channel` = 'sms' AND `version` = 1;
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
