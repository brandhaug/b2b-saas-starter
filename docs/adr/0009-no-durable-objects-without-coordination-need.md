# No Durable Objects without a coordination need

Workspace requests, MCP calls, and queued work do not need a single coordinating instance. Durable Objects remain out of scope until a concrete workflow needs shared live state or coordination; adding them now would introduce another lifecycle and storage model without an owner.
