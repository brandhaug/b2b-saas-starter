# Durable Objects require a coordination need

The [accepted persistent assistant specification](https://github.com/brandhaug/b2b-saas-starter/issues/444) establishes a concrete coordination need: one active answer per private conversation, shared progress across its creator's tabs, and stream replay after browser disconnection. Use one SQLite Durable Object with AIChatAgent per conversation. D1 keeps the directory, access/lifecycle metadata, shared admission limits and existing business records.

D1 alone can save history; the coordinated active answer and replay protocol justify Durable Objects here. The [accepted prototype](https://github.com/brandhaug/b2b-saas-starter/issues/446) verified the Effect integration locally. Browser reconnection catches up with the existing answer. Process interruption recovers saved partial output and requires explicit Retry; the latest unflushed text may be lost. Workflows and general autonomous-agent execution are outside this use case.

This is an accepted design awaiting implementation and deployed validation. Other features still need their own concrete coordination requirement before adding Durable Objects or realtime transport.
