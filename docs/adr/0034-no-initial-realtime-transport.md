# No initial realtime transport

The starter does not include WebSocket or SSE realtime UI transport in the initial scaffold. Notifications, catalog refresh status, implementation reports, webhook deliveries, and module readiness should use Effect Atom query invalidation, polling where useful, and manual refresh until a concrete realtime workflow justifies connection management.
