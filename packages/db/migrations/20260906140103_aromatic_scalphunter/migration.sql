ALTER TABLE `api_tokens` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `replaced_by_token_id` text;