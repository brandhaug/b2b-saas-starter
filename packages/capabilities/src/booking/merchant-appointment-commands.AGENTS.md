# Merchant Appointment Commands

`merchant-appointment-commands.ts` owns the authenticated Owner operating loop for
Merchant-created Appointments, completed-visit entry, finite Appointment Series,
later Appointment changes, outcomes, cancellation, and External Collections.

- Derive Merchant and actor authority from `MerchantContext`; command input must
  never select a Merchant, actor, or Provider.
- Keep commands explicit, revisioned, idempotent, and atomic. A command touching
  multiple Appointments verifies every revision and commits all or none.
- Current catalog facts are read only when creating or explicitly changing the
  selected Services. Persisted Appointment snapshots remain historical authority.
- Scheduled occupied intervals never overlap. Past completed facts may overlap and
  External Collections never reserve time.
- External Collections are append-only operational facts, bounded from zero through
  the immutable Appointment total. They are not Payments or verified revenue.
- Series membership and cadence are immutable after materialization. Only
  Appointment-scoped commands and Cancel Remaining Series may mutate members.
- Store notification choices and private suppression reasons in operation history;
  notification routing and delivery remain owned by the Notifications context.
- Restricted Access blocks new Appointments and Series, but safe handling of existing
  commitments remains available. Merchant Access Holds block every command.
