# Gift Card Redemption

Own Gift Card available value, checkout reservations, immutable redemption and
refund ledger facts, and Gift Card portions of Settlement Allocations.

- Gift Card value is tender, never a Pricing Adjustment. Reservations may bind a
  Pricing Quote but must not change its total.
- Currency and Merchant, Brand, Shop, or Provider scope are fixed by issuance and
  checked from server-owned Booking Party topology.
- Reserve by appending negative ledger value; release appends the inverse. Commit
  appends a release plus the final redemption so immutable history and available
  balance remain independently auditable.
- Booking Confirmation is the orchestration boundary that commits Appointments,
  reservations, ledger entries, and every settlement allocation in one D1 batch.
- Refunds restore the original Gift Card allocations. External Payment refunds are
  separate obligations; never void issuance that may already have been spent.
