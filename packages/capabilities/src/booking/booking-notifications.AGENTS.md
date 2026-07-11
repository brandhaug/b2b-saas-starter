# Booking Notifications

This capability owns durable claiming and sanitized channel state for committed
Booking outbox work. D1 is the source of truth; queue messages are wake-ups.

- Claims are atomic, completed work is a no-op, and claims older than one minute are recoverable.
- Store one byte-stable, PII-free `appointment.created` event per outbox item.
- Delivery history stores metadata only. Never add bodies, Customer Details, signing material, Confirmation secrets, or free-form exceptions.
- Email and HTTP I/O remain in `apps/background`; this module owns persistence.
