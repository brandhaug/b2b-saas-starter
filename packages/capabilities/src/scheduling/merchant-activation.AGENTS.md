# Merchant Activation

`merchant-activation.ts` owns the one-time Solo activation decision. Progress is
derived from current authoritative facts; the persisted state contains confirmations,
the revision-bound Launch Test, and permanent first-publication evidence only.

Preview and Launch Test return a simulation result and must never call Appointment,
Customer Directory, hold-consumption, or notification capabilities. First publication
must re-evaluate the same facts inside the publication transaction.
