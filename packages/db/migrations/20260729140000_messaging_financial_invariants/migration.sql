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
