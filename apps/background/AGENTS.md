# apps/background

Booking Product background worker. It consumes booking-event wakeups and runs the
five-minute durable recovery sweep for Booking, Appointment email, and global
Operations notifications. D1 intent/outbox state is authoritative; queue
publication is only a wakeup. Appointment email provider acceptance is not
delivery; only verified callbacks may advance it to delivered.
Operations notification delivery must preserve its sanitized target-facing payload
and never expose the System Operator identity or internal Impersonation Reason.
Generic Starter catalog refresh and Workspace webhook queues do not belong here.
