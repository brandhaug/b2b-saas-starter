# Appointment Operations

`appointment-operations.ts` owns Merchant-side, read-only operational projections of confirmed Appointments.

- Calendar, detail, and Customer Directory reads require a resolved `MerchantContext`.
- Appointment snapshots are the sole source for Provider, Service, Customer Details, quote, and checkout facts. Never join current catalog or Public Booking Page state into these projections.
- Cross-Merchant detail reads return `not_found`, identical to an unknown Appointment ID.
- The Customer Directory emits one entry per Appointment. Matching email or phone values never imply identity and are never merged.
- Keep Appointment mutation and standalone Customer storage out of this capability.
