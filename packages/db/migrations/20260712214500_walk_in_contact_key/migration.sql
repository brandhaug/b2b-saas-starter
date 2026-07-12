ALTER TABLE `walk_in_entries` ADD `contact_key` text;
CREATE UNIQUE INDEX `walk_in_entries_active_contact_unique` ON `walk_in_entries` (`shop_id`, `contact_key`) WHERE `status` IN ('waiting', 'called', 'serving');
