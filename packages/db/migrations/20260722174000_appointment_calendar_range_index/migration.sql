DROP INDEX `appointments_merchant_id_idx`;
CREATE INDEX `appointments_merchant_starts_at_idx` ON `appointments` (`merchant_id`,`starts_at`);
