CREATE TABLE `operations_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`business_event_id` text NOT NULL,
	`actor_operator_id` text NOT NULL,
	`actor_display_name` text NOT NULL,
	`operator_session_id` text,
	`impersonation_id` text,
	`target_id` text,
	`target_display_name` text,
	`merchant_id` text,
	`merchant_display_name` text,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`occurred_at` text NOT NULL,
	`retention_policy` text NOT NULL,
	`retain_until` text,
	`internal_reason` text,
	`support_reference` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_audit_events_business_event_idx` ON `operations_audit_events` (`business_event_id`);
--> statement-breakpoint
CREATE INDEX `operations_audit_events_occurred_at_idx` ON `operations_audit_events` (`occurred_at`,`id`);
--> statement-breakpoint
CREATE INDEX `operations_audit_events_actor_idx` ON `operations_audit_events` (`actor_operator_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `operations_audit_events_merchant_idx` ON `operations_audit_events` (`merchant_id`,`occurred_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `operations_audit_events` (
	`id`, `business_event_id`, `actor_operator_id`, `actor_display_name`, `operator_session_id`, `impersonation_id`,
	`target_id`, `target_display_name`, `merchant_id`, `merchant_display_name`,
	`action`, `result`, `occurred_at`, `retention_policy`, `retain_until`,
	`internal_reason`, `support_reference`, `created_at`
)
SELECT
	'oaud_projected_' || source.id,
	'legacy:' || source.id,
	coalesce(source.actor_user_id, json_extract(source.metadata, '$.actor'), 'system'),
	coalesce(actor.name, json_extract(source.metadata, '$.actor'), source.actor_user_id, 'System'),
	json_extract(source.metadata, '$.operatorSessionId'),
	json_extract(source.metadata, '$.impersonationId'),
	source.target_id,
	coalesce(target.name, json_extract(source.metadata, '$.targetEmail'), source.target_id),
	source.merchant_id,
	coalesce(merchant.public_name, source.merchant_id),
	source.event_type,
	CASE WHEN source.event_type = 'operations.authentication.rate-limited' THEN 'rejected'
		ELSE coalesce(json_extract(source.metadata, '$.result'), 'accepted') END,
	source.created_at,
	CASE WHEN json_extract(source.metadata, '$.impersonationId') IS NOT NULL OR source.event_type LIKE 'operations.impersonation.%' OR source.event_type LIKE 'impersonation.%'
		THEN 'impersonation-two-years' ELSE 'operations-standard' END,
	CASE WHEN json_extract(source.metadata, '$.impersonationId') IS NOT NULL OR source.event_type LIKE 'operations.impersonation.%' OR source.event_type LIKE 'impersonation.%'
		THEN strftime('%Y-%m-%dT%H:%M:%fZ', source.created_at, '+2 years') ELSE NULL END,
	json_extract(source.metadata, '$.reason'),
	json_extract(source.metadata, '$.supportReference'),
	source.created_at
FROM audit_events AS source
LEFT JOIN user AS actor ON actor.id = source.actor_user_id
LEFT JOIN user AS target ON target.id = source.target_id
LEFT JOIN merchants AS merchant ON merchant.id = source.merchant_id
WHERE source.event_type LIKE 'operations.%' OR source.event_type LIKE 'operator.%' OR source.event_type LIKE 'impersonation.%';
--> statement-breakpoint
CREATE TRIGGER `project_global_operations_audit`
AFTER INSERT ON `audit_events`
WHEN NEW.event_type LIKE 'operations.%' OR NEW.event_type LIKE 'operator.%' OR NEW.event_type LIKE 'impersonation.%'
BEGIN
	INSERT OR IGNORE INTO `operations_audit_events` (
		`id`, `business_event_id`, `actor_operator_id`, `actor_display_name`, `operator_session_id`, `impersonation_id`,
		`target_id`, `target_display_name`, `merchant_id`, `merchant_display_name`,
		`action`, `result`, `occurred_at`, `retention_policy`, `retain_until`,
		`internal_reason`, `support_reference`, `created_at`
	) VALUES (
		'oaud_projected_' || NEW.id,
		'legacy:' || NEW.id,
		coalesce(NEW.actor_user_id, json_extract(NEW.metadata, '$.actor'), 'system'),
		coalesce((SELECT name FROM user WHERE id = NEW.actor_user_id), json_extract(NEW.metadata, '$.actor'), NEW.actor_user_id, 'System'),
		json_extract(NEW.metadata, '$.operatorSessionId'),
		json_extract(NEW.metadata, '$.impersonationId'),
		NEW.target_id,
		coalesce((SELECT name FROM user WHERE id = NEW.target_id), json_extract(NEW.metadata, '$.targetEmail'), NEW.target_id),
		NEW.merchant_id,
		coalesce((SELECT public_name FROM merchants WHERE id = NEW.merchant_id), NEW.merchant_id),
		NEW.event_type,
		CASE WHEN NEW.event_type = 'operations.authentication.rate-limited' THEN 'rejected'
			ELSE coalesce(json_extract(NEW.metadata, '$.result'), 'accepted') END,
		NEW.created_at,
		CASE WHEN json_extract(NEW.metadata, '$.impersonationId') IS NOT NULL OR NEW.event_type LIKE 'operations.impersonation.%' OR NEW.event_type LIKE 'impersonation.%'
			THEN 'impersonation-two-years' ELSE 'operations-standard' END,
		CASE WHEN json_extract(NEW.metadata, '$.impersonationId') IS NOT NULL OR NEW.event_type LIKE 'operations.impersonation.%' OR NEW.event_type LIKE 'impersonation.%'
			THEN strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '+2 years') ELSE NULL END,
		json_extract(NEW.metadata, '$.reason'),
		json_extract(NEW.metadata, '$.supportReference'),
		NEW.created_at
	);
END;
