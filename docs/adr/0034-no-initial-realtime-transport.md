# No realtime transport without a live workflow

The starter uses loader invalidation, selective polling, and manual refresh for changing workspace data. WebSocket or SSE transport remains out of scope until a workflow requires live updates strongly enough to justify connection lifecycle and authorization work.
