ALTER TABLE `walk_in_entries` ADD `expires_at` text;
CREATE INDEX `walk_in_entries_shop_status_expiry_idx` ON `walk_in_entries` (`shop_id`, `status`, `expires_at`);
