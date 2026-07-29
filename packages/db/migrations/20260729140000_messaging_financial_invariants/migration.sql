CREATE TABLE `messaging_financial_external_facts` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `kind` text NOT NULL,
  `provider` text NOT NULL,
  `source_id` text NOT NULL,
  `status` text NOT NULL,
  `amount_milli_euro` integer,
  `currency` text NOT NULL,
  `reference` text,
  `related_source_id` text,
  `observed_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `messaging_financial_external_facts_source_unique`
    UNIQUE (`kind`, `provider`, `source_id`, `status`),
  CONSTRAINT `messaging_financial_external_facts_shop_fk`
    FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `messaging_financial_external_facts_kind_check`
    CHECK (`kind` IN ('provider_payment', 'provider_refund', 'invoice', 'credit_note', 'efactura')),
  CONSTRAINT `messaging_financial_external_facts_status_check`
    CHECK (`status` IN ('pending', 'confirmed', 'failed', 'issued', 'submitted',
                        'accepted', 'rejected', 'cancelled')),
  CONSTRAINT `messaging_financial_external_facts_amount_check`
    CHECK (`amount_milli_euro` IS NULL OR `amount_milli_euro` >= 0)
);
--> statement-breakpoint
CREATE INDEX `messaging_financial_external_facts_reconciliation_idx`
  ON `messaging_financial_external_facts` (`shop_id`, `observed_at`, `id`);
--> statement-breakpoint
CREATE TRIGGER `messaging_financial_external_facts_no_update`
  BEFORE UPDATE ON `messaging_financial_external_facts`
  BEGIN SELECT RAISE(ABORT, 'messaging financial external facts are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `messaging_financial_external_facts_no_delete`
  BEFORE DELETE ON `messaging_financial_external_facts`
  BEGIN SELECT RAISE(ABORT, 'messaging financial external facts are append-only'); END;
--> statement-breakpoint
ALTER TABLE `messaging_balance_ledger_entries`
  ADD COLUMN `external_fact_id` text
  REFERENCES `messaging_financial_external_facts` (`id`);
--> statement-breakpoint
CREATE TRIGGER `messaging_rate_cards_notice_guard`
  BEFORE INSERT ON `messaging_rate_cards`
  WHEN NEW.version > 1 AND (
    NEW.notice_published_at IS NULL OR
    julianday(NEW.effective_at) - julianday(NEW.notice_published_at) < 30
  )
  BEGIN
    SELECT RAISE(ABORT, 'messaging rate cards require at least 30 days notice');
  END;
--> statement-breakpoint
CREATE TRIGGER `messaging_rate_cards_price_identity_immutable`
  BEFORE UPDATE ON `messaging_rate_cards`
  WHEN NEW.id IS NOT OLD.id OR
       NEW.version IS NOT OLD.version OR
       NEW.currency IS NOT OLD.currency OR
       NEW.charge_milli_euro IS NOT OLD.charge_milli_euro OR
       NEW.effective_at IS NOT OLD.effective_at OR
       NEW.notice_published_at IS NOT OLD.notice_published_at OR
       NEW.created_at IS NOT OLD.created_at
  BEGIN
    SELECT RAISE(ABORT, 'messaging rate card price identity is immutable');
  END;
--> statement-breakpoint
CREATE TRIGGER `messaging_balance_debit_available_guard`
  BEFORE INSERT ON `messaging_balance_ledger_entries`
  WHEN NEW.direction = 'debit' AND COALESCE((
    SELECT available_milli_euro
    FROM merchant_messaging_balance_summaries
    WHERE shop_id = NEW.shop_id
  ), 0) < NEW.amount_milli_euro
  BEGIN
    SELECT RAISE(ABORT, 'messaging balance available amount cannot become negative');
  END;
--> statement-breakpoint
CREATE TRIGGER `messaging_balance_reservation_available_guard`
  BEFORE INSERT ON `messaging_balance_reservations`
  WHEN NEW.status = 'active' AND (
    COALESCE((
      SELECT financially_frozen
      FROM merchant_messaging_balance_summaries
      WHERE shop_id = NEW.shop_id
    ), 1) = 1 OR
    COALESCE((
      SELECT available_milli_euro
      FROM merchant_messaging_balance_summaries
      WHERE shop_id = NEW.shop_id
    ), 0) < NEW.amount_milli_euro
  )
  BEGIN
    SELECT RAISE(ABORT, 'messaging balance reservation exceeds available amount');
  END;
--> statement-breakpoint
CREATE TRIGGER `messaging_balance_reservation_state_insert_guard`
  BEFORE INSERT ON `messaging_balance_reservations`
  WHEN NOT (
    (NEW.status = 'active' AND NEW.converted_at IS NULL AND NEW.released_at IS NULL) OR
    (NEW.status = 'converted' AND NEW.converted_at IS NOT NULL AND NEW.released_at IS NULL) OR
    (NEW.status = 'released' AND NEW.converted_at IS NULL AND NEW.released_at IS NOT NULL)
  )
  BEGIN
    SELECT RAISE(ABORT, 'messaging balance reservation state is incoherent');
  END;
--> statement-breakpoint
CREATE TRIGGER `messaging_balance_reservation_state_update_guard`
  BEFORE UPDATE ON `messaging_balance_reservations`
  WHEN NOT (
    (OLD.status = 'active' AND NEW.status IN ('converted', 'released')) OR
    (OLD.status = NEW.status)
  ) OR NOT (
    (NEW.status = 'active' AND NEW.converted_at IS NULL AND NEW.released_at IS NULL) OR
    (NEW.status = 'converted' AND NEW.converted_at IS NOT NULL AND NEW.released_at IS NULL) OR
    (NEW.status = 'released' AND NEW.converted_at IS NULL AND NEW.released_at IS NOT NULL)
  )
  BEGIN
    SELECT RAISE(ABORT, 'messaging balance reservation transition is incoherent');
  END;
--> statement-breakpoint
CREATE TRIGGER `messaging_balance_correction_guard`
  BEFORE INSERT ON `messaging_balance_ledger_entries`
  WHEN NEW.kind = 'correction' AND NOT EXISTS (
    SELECT 1
    FROM messaging_balance_ledger_entries original
    WHERE original.id = NEW.reverses_entry_id
      AND original.shop_id = NEW.shop_id
      AND original.kind <> 'correction'
      AND original.amount_milli_euro = NEW.amount_milli_euro
      AND original.direction <> NEW.direction
  )
  BEGIN
    SELECT RAISE(ABORT, 'messaging balance correction must compensate one original entry');
  END;
--> statement-breakpoint
CREATE TRIGGER `messaging_balance_financial_provenance_guard`
  BEFORE INSERT ON `messaging_balance_ledger_entries`
  WHEN
    (NEW.kind = 'top_up' AND (
      NEW.amount_milli_euro NOT IN (10000, 25000, 50000) OR
      NULLIF(trim(NEW.fiscal_reference), '') IS NULL OR
      NEW.external_fact_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM messaging_financial_external_facts fact
        WHERE fact.id = NEW.external_fact_id
          AND fact.shop_id = NEW.shop_id
          AND fact.kind = 'provider_payment'
          AND fact.status = 'confirmed'
          AND fact.amount_milli_euro = NEW.amount_milli_euro
          AND fact.currency = 'EUR'
          AND fact.source_id = NEW.source_id
      )
    )) OR
    (NEW.kind IN ('operator_adjustment', 'refund', 'promotional_credit') AND (
      NEW.actor_type IS NOT 'system_operator' OR
      NULLIF(trim(NEW.actor_id), '') IS NULL OR
      NULLIF(trim(NEW.reason), '') IS NULL OR
      (NEW.kind = 'refund' AND NULLIF(trim(NEW.fiscal_reference), '') IS NULL)
    )) OR
    (NEW.kind = 'correction' AND (
      NEW.actor_type IS NULL OR NEW.actor_type NOT IN ('system', 'system_operator') OR
      NULLIF(trim(NEW.actor_id), '') IS NULL OR
      NULLIF(trim(NEW.reason), '') IS NULL
    ))
  BEGIN
    SELECT RAISE(ABORT, 'messaging balance financial provenance is required');
  END;
