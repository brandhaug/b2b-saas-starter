# apps/background

Booking Product background worker. It consumes booking-event wakeups and runs the
five-minute durable outbox recovery sweep. The D1 outbox is authoritative; queue
publication is only a wakeup. Generic Starter catalog refresh and Workspace webhook
queues do not belong here.
