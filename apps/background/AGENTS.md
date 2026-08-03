# apps/background

Booking Product background worker. It consumes booking-event wakeups and runs the
five-minute durable outbox recovery sweep for Booking and global Operations
notifications. D1 outbox state is authoritative; queue publication is only a wakeup.
Operations notification delivery must preserve its sanitized target-facing payload
and never expose the System Operator identity or internal Impersonation Reason.
Generic Starter catalog refresh and Workspace webhook queues do not belong here.
